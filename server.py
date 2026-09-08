# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
한토레 ローカルサーバー

  uv run server.py [--port 8080]

役割は2つだけ:
  1. 静的配信（学習アプリ index.html / 管理画面 admin.html）
  2. 字幕取得API（YouTube の内部API から韓国語字幕＋日本語訳字幕を取得して正規化）

字幕は YouTube の内部API（InnerTube）を直接叩いて取得する。標準ライブラリだけで動き、
外部依存は無い。取得できなくなったときは CLIENTS の定義を更新する（下のコメント参照）。

単語の抽出・既知語の同定・問題の生成はすべてブラウザ側（js/extract.js）で行う。
活用エンジン（js/hangul.js）と辞書（js/data.js）を Python に二重実装しないため。
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DECKS = os.path.join(ROOT, "decks")
CACHE = os.path.join(DECKS, ".cache")
LINES = os.path.join(DECKS, "lines")   # 字幕本文だけを置く場所（公開リポジトリには含めない）

# InnerTube のクライアント定義。上から順に試し、字幕トラックが取れたものを使う。
#   値の出典は yt-dlp の extractor/youtube/_base.py の INNERTUBE_CLIENTS。
#   YouTube に塞がれて取得できなくなったら、最新の yt-dlp のその定義を見てここを更新する。
#   （実測: WEB / MWEB は UNPLAYABLE、ANDROID_VR は LOGIN_REQUIRED、IOS だけが通る。2026-09 時点）
IOS_DEVICE = {"deviceMake": "Apple", "deviceModel": "iPhone16,2",
              "osName": "iPhone", "osVersion": "18.3.2.22D82"}
CLIENTS = [
    {"name": "IOS", "version": "21.26.4", "id": 5, "extra": IOS_DEVICE,
     "ua": "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"},
    {"name": "IOS", "version": "20.10.4", "id": 5, "extra": IOS_DEVICE,
     "ua": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)"},
    {"name": "MWEB", "version": "2.20250101.00.00", "id": 2, "extra": {},
     "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 "
           "(KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"},
    {"name": "WEB", "version": "2.20250101.00.00", "id": 1, "extra": {},
     "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"},
]
INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"

MAX_LINES = 1200          # これを超えたら等間隔サンプリング
MIN_HANGUL_RATIO = 0.3    # ハングル文字率がこれ未満なら韓国語動画ではないと判断
ALIGN_TOLERANCE_MS = 700  # ko/ja のセグメント数が違うときの時刻マッチ許容幅

NOISE_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)|[♪♬≪≫]")
HANGUL_RE = re.compile(r"[가-힣]")


# ============================================================
# 字幕の取得と正規化
# ============================================================
def video_id_of(url):
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def http_request(url, data=None, headers=None, timeout=30):
    """外向きの HTTP はすべてここを通す（将来 TLS 偽装が必要になったらこの関数だけ差し替える）"""
    req = urllib.request.Request(url, data=data, headers=headers or {})
    r = urllib.request.urlopen(req, timeout=timeout)
    return r.status, r.read()


def innertube_player(vid, log):
    """InnerTube の player を叩いて、字幕トラックの入った応答を得る。

    クライアント候補を上から順に試す。全部だめなら、どれがどう落ちたかを添えて失敗する。
    """
    tried, statuses = [], []
    for c in CLIENTS:
        ctx = {"clientName": c["name"], "clientVersion": c["version"], "hl": "ko"}
        ctx.update(c["extra"])
        body = json.dumps({"videoId": vid, "context": {"client": ctx},
                           "contentCheckOk": True, "racyCheckOk": True}).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": c["ua"],
                   "X-YouTube-Client-Name": str(c["id"]), "X-YouTube-Client-Version": c["version"]}
        label = "%s/%s" % (c["name"], c["version"])
        t0 = time.time()
        try:
            status, raw = http_request(INNERTUBE_URL, body, headers)
            pr = json.loads(raw.decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            tried.append("%s: %s" % (label, e))
            log("クライアント %s は失敗（%s）" % (label, e))
            continue
        st = (pr.get("playabilityStatus") or {}).get("status")
        tracks = (((pr.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {})
                  .get("captionTracks") or [])
        got = (pr.get("videoDetails") or {}).get("videoId")
        if st == "OK" and got == vid and tracks:
            log("動画情報を取得（%s / %.2f秒 / 字幕 %d トラック）" % (label, time.time() - t0, len(tracks)))
            return pr, label
        why = st if st != "OK" else ("動画IDが不一致" if got != vid else "字幕トラックなし")
        reason = (pr.get("playabilityStatus") or {}).get("reason") or ""
        statuses.append(st)
        tried.append("%s: %s %s" % (label, why, reason))
        log("クライアント %s は使えません（%s %s）" % (label, why, reason))

    # どのクライアントでも同じ「見られない」なら、原因はこちらではなく動画側
    if statuses and all(st in ("ERROR", "UNPLAYABLE", "LOGIN_REQUIRED") for st in statuses):
        raise UserError("この動画は再生できません（削除済み・非公開・年齢制限・地域制限など）。"
                        "YouTube の応答: %s" % (tried[0].split(": ", 1)[-1] or "-"))
    raise UserError("YouTube から字幕情報を取得できませんでした（%s）。"
                    "YouTube 側の仕様変更の可能性があります。server.py の CLIENTS の定義を"
                    "最新の yt-dlp（extractor/youtube/_base.py の INNERTUBE_CLIENTS）に合わせて更新してください"
                    % " / ".join(tried[:4]))


def caption_url(base_url, tlang=None):
    """字幕URLを json3 形式に整える。xosf は json3 に不要な位置情報が入るので外す"""
    u = urllib.parse.urlsplit(base_url)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query) if k not in ("fmt", "xosf", "tlang")]
    q.append(("fmt", "json3"))
    if tlang:
        q.append(("tlang", tlang))
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), ""))


def needs_pot(base_url):
    """PO トークンが要る実験（exp=xpe / xpv）に当たっていないか。当たっていると本文が空で返る"""
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(base_url).query)
    return any(e in q.get("exp", []) for e in ("xpe", "xpv"))


def pick_track(player):
    """(韓国語トラック名, 韓国語URL, 手動字幕か, (日本語トラック名, 日本語URL))"""
    tracks = (((player.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {})
              .get("captionTracks") or [])
    langs = [t.get("languageCode") for t in tracks]

    def ko_of(asr):
        for t in tracks:
            if not (t.get("languageCode") or "").startswith("ko"):
                continue
            if (t.get("kind") == "asr") == asr:
                return t
        return None

    ko = ko_of(False)                      # 手動の韓国語字幕を最優先（音声認識の誤りがない）
    manual = ko is not None
    if not ko:
        ko = ko_of(True)
    if not ko:
        if not tracks:
            raise UserError("この動画には字幕（手動・自動とも）がありません")
        raise UserError("韓国語字幕が無いため対象外です（ある字幕: %s）"
                        % ", ".join(sorted(set(filter(None, langs)))[:12]))
    if needs_pot(ko["baseUrl"]):
        raise UserError("この字幕URLは YouTube の実験（exp=xpe）の対象で本文を取得できません。"
                        "server.py の CLIENTS の定義を更新してください")

    ko_key = "ko" if manual else "ko-orig"   # 既存デッキの koTrack と同じ表記にそろえる
    return ko_key, caption_url(ko["baseUrl"]), manual, _ja(tracks, ko)


def _ja(tracks, ko_track):
    """日本語訳。本物の日本語字幕があればそれを、無ければ韓国語トラックの機械翻訳を使う。

    翻訳できるかは translationLanguages を見ない（IOS クライアントでは常に空で返るため）。
    """
    for t in tracks:
        if (t.get("languageCode") or "").startswith("ja"):
            return "ja", caption_url(t["baseUrl"])
    if ko_track.get("isTranslatable") is False:
        return None, None
    return "ja", caption_url(ko_track["baseUrl"], tlang="ja")


def download_json3(url, cache_path, log, refresh=False):
    """字幕本文を取得。キャッシュがあれば使う（YouTube は短時間の連続取得を 429 で弾くため）"""
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                j = json.load(f)
            log("キャッシュを使用: %s" % os.path.basename(cache_path))
            return j
        except (OSError, ValueError):
            pass

    headers = {"User-Agent": CLIENTS[0]["ua"], "Accept-Language": "ko,ja;q=0.9,en;q=0.8"}
    last = None
    for attempt, wait in enumerate(((0, 3, 8, 15)), start=1):
        if wait:
            log("字幕の取得に失敗したので %d 秒待って再試行します（%d/4）" % (wait, attempt))
            time.sleep(wait)
        try:
            status, body = http_request(url, headers=headers)
            if not body:
                # 200 なのに空 ＝ PO トークンが要る実験に当たっている。再試行しても無駄
                raise UserError("YouTube が空の字幕を返しました。"
                                "server.py の CLIENTS の定義を更新してください")
            raw = body.decode("utf-8", "replace")
            try:
                j = json.loads(raw)
            except ValueError:
                raise UserError("字幕の形式が想定と違います（YouTube 側の仕様変更の可能性）")
            try:
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                tmp = cache_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(raw)
                os.replace(tmp, cache_path)          # 読み取り中のファイルを壊さない
            except OSError as e:
                log("キャッシュの保存に失敗（続行します）: %s" % e)
            return j
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503):
                break
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
    if isinstance(last, urllib.error.HTTPError) and last.code == 429:
        raise UserError("YouTube から字幕の取得を制限されました（429）。"
                        "少し時間をおいて、もう一度お試しください")
    raise UserError("字幕の取得に失敗しました: %s" % last)


def events_of(j):
    """json3 → [(開始ms, テキスト)] 。空セグメントは捨てる"""
    out = []
    for e in j.get("events") or []:
        segs = e.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs)
        text = text.replace("\n", " ").strip()
        if text:
            out.append((int(e.get("tStartMs") or 0), text))
    return out


def clean(text):
    text = NOISE_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def align(ko_events, ja_events, log):
    """韓国語と日本語のセグメントを対応付けて [(ms, ko, ja)] を返す"""
    if not ja_events:
        return [(t, k, "") for t, k in ko_events], "none"
    if len(ko_events) == len(ja_events):
        log("字幕の対応付け: セグメント番号で一致（%d件）" % len(ko_events))
        return [(t, k, ja_events[i][1]) for i, (t, k) in enumerate(ko_events)], "index"

    log("セグメント数が異なる（ko %d / ja %d）ので時刻で対応付けます" % (len(ko_events), len(ja_events)))
    times = [t for t, _ in ja_events]
    pairs, hit = [], 0
    for t, k in ko_events:
        best, bestd = "", ALIGN_TOLERANCE_MS + 1
        lo = 0
        for i, jt in enumerate(times):
            d = abs(jt - t)
            if d < bestd:
                bestd, best = d, ja_events[i][1]
        if bestd <= ALIGN_TOLERANCE_MS:
            hit += 1
        else:
            best = ""
        pairs.append((t, k, best))
    rate = hit / max(1, len(pairs))
    if rate < 0.7:
        log("対応率が %.0f%% と低いため日本語訳は使いません" % (rate * 100))
        return [(t, k, "") for t, k, _ in pairs], "none"
    return pairs, "time"


def build_lines(pairs, log):
    """ノイズ除去 → 空行破棄 → 連続重複の圧縮 → 長すぎる場合は等間隔サンプリング"""
    lines = []
    for t, ko, ja in pairs:
        ko, ja = clean(ko), clean(ja)
        if not ko:
            continue
        if lines and lines[-1]["ko"] == ko:      # 自動字幕のローリング重複
            continue
        lines.append({"t": t, "ko": ko, "ja": ja})

    if len(lines) > MAX_LINES:
        step = len(lines) / MAX_LINES
        log("字幕が %d 行と多いため %d 行に等間隔サンプリングします" % (len(lines), MAX_LINES))
        lines = [lines[int(i * step)] for i in range(MAX_LINES)]

    for i, l in enumerate(lines):
        l["i"] = i
    return lines


def hangul_ratio(lines):
    total = hangul = 0
    for l in lines:
        for ch in l["ko"]:
            if ch.isspace():
                continue
            total += 1
            if HANGUL_RE.match(ch):
                hangul += 1
    return (hangul / total) if total else 0.0


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128       # 既定の5だと並列リクエストで接続が溢れる
    allow_reuse_address = True


class UserError(Exception):
    """利用者に見せるエラー（スタックトレースを出さない）"""


def analyze(url, log, refresh=False):
    vid = video_id_of(url)
    if not vid:
        raise UserError("YouTube の動画URLではないようです: %s" % url)

    player, client = innertube_player(vid, log)
    vd = player.get("videoDetails") or {}
    log("動画: %s（%s）" % (vd.get("title"), vd.get("author") or "-"))

    ko_track, ko_url, manual, (ja_track, ja_url) = pick_track(player)
    log("韓国語字幕: %s%s" % (ko_track, "（手動字幕・高品質）" if manual else "（自動字幕）"))
    log("日本語訳字幕: %s" % (ja_track or "なし"))

    ko_events = events_of(download_json3(ko_url, os.path.join(CACHE, vid + ".ko.json3"), log, refresh))
    ja_events = []
    if ja_url:
        # 日本語訳字幕は「あれば使う」。取れなくても韓国語だけで続行する
        try:
            ja_events = events_of(download_json3(ja_url, os.path.join(CACHE, vid + ".ja.json3"), log, refresh))
        except (UserError, ValueError) as e:
            log("日本語訳字幕は取得できませんでした（%s）。韓国語のみで続行します" % e)
            ja_track = None
    log("取得したセグメント: ko %d / ja %d" % (len(ko_events), len(ja_events)))

    pairs, aligned = align(ko_events, ja_events, log)
    lines = build_lines(pairs, log)
    if not lines:
        raise UserError("字幕から使える行が取れませんでした")

    ratio = hangul_ratio(lines)
    log("字幕 %d 行 / ハングル文字率 %.0f%%" % (len(lines), ratio * 100))
    if ratio < MIN_HANGUL_RATIO:
        raise UserError("韓国語の動画ではないようです（ハングル %.0f%%）" % (ratio * 100))

    return {
        "schema": 1,
        "id": vid,
        "source": {
            "url": "https://www.youtube.com/watch?v=" + vid,
            "title": vd.get("title") or vid,
            "channel": vd.get("author") or "",
            "durationSec": int(vd.get("lengthSeconds") or 0),
            "uploadDate": "",          # InnerTube の応答には入っていない（UI では未使用）
        },
        "captions": {
            "koTrack": ko_track, "jaTrack": ja_track or "", "manual": manual,
            "aligned": aligned, "lines": len(lines), "hangulRatio": round(ratio, 3),
        },
        "generated": {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                      "fetcher": "innertube", "client": client},
        "lines": lines,
    }


# ============================================================
# デッキの保存
# ============================================================
def deck_path(vid):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid or ""):
        raise UserError("不正な動画IDです")
    return os.path.join(DECKS, vid + ".json")


def lines_path(vid):
    """字幕本文の置き場。デッキ本体（語彙データ）とは別ファイルにする。

    デッキ本体は「どの単語が何回出たか」という派生データだけなので共有できるが、
    字幕の本文は動画制作者の著作物なので decks/lines/ に分けて公開対象から外す。
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid or ""):
        raise UserError("不正な動画IDです")
    return os.path.join(LINES, vid + ".json")


def write_json(path, obj):
    """同じファイルをブラウザが読んでいる最中に壊さないよう、原子的に書き換える"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def rebuild_index():
    os.makedirs(DECKS, exist_ok=True)
    items = []
    for name in sorted(os.listdir(DECKS)):
        if not name.endswith(".json") or name in ("index.json",) or name.endswith(".tmp"):
            continue
        try:
            with open(os.path.join(DECKS, name), encoding="utf-8") as f:
                d = json.load(f)
            items.append({
                "id": d.get("id"),
                "title": (d.get("source") or {}).get("title") or d.get("id"),
                "channel": (d.get("source") or {}).get("channel") or "",
                "durationSec": (d.get("source") or {}).get("durationSec") or 0,
                "words": len([w for w in d.get("words") or [] if w.get("include") is not False]),
                "unknown": len(d.get("unknown") or []),
                "generatedAt": (d.get("generated") or {}).get("at") or "",
            })
        except (OSError, ValueError):
            continue
    items.sort(key=lambda x: x["generatedAt"], reverse=True)
    write_json(os.path.join(DECKS, "index.json"), items)
    return items


# ============================================================
# HTTP
# ============================================================
class Handler(SimpleHTTPRequestHandler):
    # HTTP/1.0 のまま（keep-alive にすると SSE の扱いが面倒になる）。
    # 1ページで十数本の接続が同時に来るので、取りこぼしは接続キューの拡大で防ぐ。
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # ---------- 共通 ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    # ---------- GET ----------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/subtitles":
            q = urllib.parse.parse_qs(parsed.query)
            return self.sse_subtitles((q.get("url") or [""])[0], (q.get("refresh") or [""])[0] == "1")
        if parsed.path == "/api/decks":
            try:
                return self.send_json(rebuild_index())
            except OSError as e:
                return self.send_json({"error": str(e)}, 500)
        if parsed.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        self.send_header_no_cache = True
        return super().do_GET()

    def end_headers(self):
        # 開発中はキャッシュさせない（編集がすぐ反映されるように）
        if getattr(self, "send_header_no_cache", False):
            self.send_header("Cache-Control", "no-store")
            self.send_header_no_cache = False
        super().end_headers()

    # ---------- 字幕取得（SSE で進捗を流す） ----------
    def sse_subtitles(self, url, refresh=False):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(event, payload):
            try:
                self.wfile.write(("event: %s\ndata: %s\n\n" %
                                  (event, json.dumps(payload, ensure_ascii=False))).encode("utf-8"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                raise UserError("クライアントが切断しました")

        def log(msg):
            sys.stderr.write("  [subs] %s\n" % msg)
            emit("log", {"msg": msg})

        try:
            emit("result", analyze(url, log, refresh))
        except UserError as e:
            emit("error", {"msg": str(e)})
        except Exception as e:                                   # 想定外の失敗
            sys.stderr.write("  [subs] %r\n" % (e,))
            emit("error", {"msg": "取得に失敗しました: %s" % e,
                           "hint": "YouTube 側の仕様変更かもしれません。server.py の CLIENTS の定義を"
                                   "最新の yt-dlp（extractor/youtube/_base.py）に合わせて更新してください"})

    # ---------- デッキ保存・削除 ----------
    def do_PUT(self):
        m = re.fullmatch(r"/api/decks/([A-Za-z0-9_-]{11})", urllib.parse.urlparse(self.path).path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        try:
            deck = self.read_body()
            deck["id"] = m.group(1)
            os.makedirs(DECKS, exist_ok=True)
            # 字幕本文は別ファイルへ（デッキ本体には残さない）
            lines = deck.pop("lines", None)
            has_lines = bool(lines) or os.path.exists(lines_path(deck["id"]))
            deck["linesFile"] = ("lines/" + deck["id"] + ".json") if has_lines else None
            write_json(deck_path(deck["id"]), deck)
            if lines:
                os.makedirs(LINES, exist_ok=True)
                write_json(lines_path(deck["id"]), {"id": deck["id"], "lines": lines})
            index = rebuild_index()
            sys.stderr.write("  [deck] 保存: %s（%d語 / 字幕%d行）\n"
                             % (deck["id"], len(deck.get("words") or []), len(lines or [])))
            return self.send_json({"ok": True, "id": deck["id"], "index": index})
        except (UserError, ValueError, OSError) as e:
            return self.send_json({"error": str(e)}, 400)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/decks/([A-Za-z0-9_-]{11})", urllib.parse.urlparse(self.path).path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        try:
            for p in (deck_path(m.group(1)), lines_path(m.group(1))):
                if os.path.exists(p):
                    os.remove(p)
            return self.send_json({"ok": True, "index": rebuild_index()})
        except (UserError, OSError) as e:
            return self.send_json({"error": str(e)}, 400)


def main():
    ap = argparse.ArgumentParser(description="한토레 ローカルサーバー")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(LINES, exist_ok=True)
    rebuild_index()
    srv = Server((args.host, args.port), Handler)
    print("한토레 サーバー起動")
    print("  学習アプリ : http://localhost:%d/index.html" % args.port)
    print("  管理画面   : http://localhost:%d/admin.html" % args.port)
    print("  停止: Ctrl+C")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")


if __name__ == "__main__":
    main()
