#!/usr/bin/env python3
"""Reference LG-ASR-WS v1 bridge backed by sherpa-onnx streaming Paraformer."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import socket
import struct
import sys
import threading
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Run a sherpa-onnx LG-ASR-WS v1 reference bridge.',
    )
    parser.add_argument('--host', default='127.0.0.1', help='Bind host. Default: 127.0.0.1')
    parser.add_argument('--port', type=int, default=15377, help='Bind port. Default: 15377')
    parser.add_argument('--path', default='/ws', help='WebSocket path. Default: /ws')
    parser.add_argument('--encoder', required=True, help='Path to encoder.onnx or encoder.int8.onnx')
    parser.add_argument('--decoder', required=True, help='Path to decoder.onnx or decoder.int8.onnx')
    parser.add_argument('--tokens', required=True, help='Path to tokens.txt')
    parser.add_argument('--model-name', default='streaming-paraformer', help='Model name shown to LG')
    parser.add_argument('--provider', default='cpu', help='sherpa runtime provider. Default: cpu')
    parser.add_argument(
        '--sample-rate',
        type=int,
        default=16000,
        help='Input sample rate. Default: 16000',
    )
    parser.add_argument(
        '--frame-duration-ms',
        type=int,
        default=40,
        help='Expected audio frame duration. Default: 40',
    )
    parser.add_argument('--num-threads', type=int, default=4, help='Decoder threads. Default: 4')
    parser.add_argument(
        '--rule1-silence',
        type=float,
        default=1.5,
        help='Endpoint rule1 trailing silence in seconds. Default: 1.5',
    )
    parser.add_argument(
        '--rule2-silence',
        type=float,
        default=0.8,
        help='Endpoint rule2 trailing silence in seconds. Default: 0.8',
    )
    parser.add_argument(
        '--rule3-max-utterance',
        type=float,
        default=20.0,
        help='Endpoint rule3 max utterance length in seconds. Default: 20.0',
    )
    parser.add_argument(
        '--auth-token',
        default='',
        help='Optional token that LG must send as session.start.authToken',
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable verbose sherpa logging and bridge request traces',
    )
    return parser


def parse_args() -> argparse.Namespace:
    parser = build_argument_parser()
    args = parser.parse_args()
    args.encoder = str(Path(args.encoder).expanduser().resolve())
    args.decoder = str(Path(args.decoder).expanduser().resolve())
    args.tokens = str(Path(args.tokens).expanduser().resolve())
    return args


def load_sherpa_onnx():
    try:
        import sherpa_onnx  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            '无法导入 sherpa_onnx。请先安装 `pip install sherpa-onnx`，并确认使用的是正确的 Python 环境。'
        ) from exc
    return sherpa_onnx


def ensure_model_files(args: argparse.Namespace) -> None:
    missing = [path for path in (args.encoder, args.decoder, args.tokens) if not Path(path).exists()]
    if missing:
        raise RuntimeError(f'找不到模型文件: {", ".join(missing)}')


@dataclass
class BridgeSession:
    args: argparse.Namespace
    sherpa_onnx: Any
    recognizer: Any | None = None
    stream: Any | None = None
    session_id: str = ''
    bridge_session_id: str = ''
    total_samples: int = 0
    utterance_index: int = 1
    utterance_start_samples: int = 0
    utterance_revision: int = 0
    last_partial_text: str = ''
    started: bool = False
    finalized: bool = False

    def start(self, payload: dict[str, Any]) -> dict[str, Any]:
        version = str(payload.get('version') or '')
        if version not in {'1', ''}:
            raise BridgeError(
                code='UNSUPPORTED_PROTOCOL_VERSION',
                message=f'Unsupported protocol version: {version}',
                retriable=False,
            )

        expected_auth = self.args.auth_token.strip()
        actual_auth = str(payload.get('authToken') or '').strip()
        if expected_auth and actual_auth != expected_auth:
            raise BridgeError(code='AUTH_ERROR', message='Invalid bridge auth token', retriable=False)

        audio = payload.get('audio') or {}
        sample_rate = int(audio.get('sampleRate') or self.args.sample_rate)
        channels = int(audio.get('channels') or 1)
        codec = str(audio.get('codec') or 'pcm_s16le')
        if sample_rate != self.args.sample_rate or channels != 1 or codec != 'pcm_s16le':
            raise BridgeError(
                code='INVALID_AUDIO_FORMAT',
                message='LG-ASR-WS v1 reference bridge only supports 16k mono pcm_s16le',
                retriable=False,
            )

        self.session_id = str(payload.get('session', {}).get('sessionId') or uuid.uuid4())
        self.bridge_session_id = f'bridge-{uuid.uuid4().hex[:12]}'
        self.recognizer = self._create_recognizer()
        self.stream = self.recognizer.create_stream()
        self.total_samples = 0
        self.utterance_index = 1
        self.utterance_start_samples = 0
        self.utterance_revision = 0
        self.last_partial_text = ''
        self.started = True
        self.finalized = False

        return {
            'type': 'session.started',
            'version': '1',
            'session': {
                'sessionId': self.session_id,
                'bridgeSessionId': self.bridge_session_id,
            },
            'bridge': {
                'name': 'sherpa-onnx-bridge',
                'engine': 'sherpa-onnx',
                'engineVersion': getattr(self.sherpa_onnx, '__version__', 'unknown'),
                'model': self.args.model_name,
                'supports': {
                    'partials': True,
                    'finals': True,
                    'tokens': False,
                    'timestamps': False,
                },
            },
        }

    def _create_recognizer(self):
        return self.sherpa_onnx.OnlineRecognizer.from_paraformer(
            encoder=self.args.encoder,
            decoder=self.args.decoder,
            tokens=self.args.tokens,
            num_threads=self.args.num_threads,
            provider=self.args.provider,
            sample_rate=self.args.sample_rate,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=self.args.rule1_silence,
            rule2_min_trailing_silence=self.args.rule2_silence,
            rule3_min_utterance_length=self.args.rule3_max_utterance,
            debug=self.args.debug,
        )

    def handle_audio_frame(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.started or self.stream is None or self.recognizer is None:
            raise BridgeError(code='BAD_REQUEST', message='session.start is required before audio.frame')

        audio = payload.get('audio') or {}
        codec = str(audio.get('codec') or 'pcm_s16le')
        if codec != 'pcm_s16le':
            raise BridgeError(code='INVALID_AUDIO_FORMAT', message=f'Unsupported audio codec: {codec}')

        data = audio.get('data')
        if not isinstance(data, str) or not data:
            raise BridgeError(code='BAD_REQUEST', message='audio.data is required')

        pcm_bytes = base64.b64decode(data)
        if len(pcm_bytes) % 2 != 0:
            raise BridgeError(code='INVALID_AUDIO_FORMAT', message='PCM payload byte length must be even')

        samples = pcm16_to_float32_list(pcm_bytes)
        self.stream.accept_waveform(self.args.sample_rate, samples)
        self.total_samples += len(samples)

        events: list[dict[str, Any]] = []
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
            partial_event = self._build_partial_event()
            if partial_event is not None:
                events.append(partial_event)

        if self.recognizer.is_endpoint(self.stream):
            final_event = self._build_final_event(final_reason='endpoint', vendor_event='endpoint')
            if final_event is not None:
                events.append(final_event)
            self.recognizer.reset(self.stream)
            self._begin_next_utterance()

        return events

    def handle_flush(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.started or self.stream is None or self.recognizer is None:
            return []

        flush_reason = str(payload.get('reason') or 'input_finished')
        if flush_reason not in {'input_finished', 'manual_flush'}:
            flush_reason = 'input_finished'

        self.stream.input_finished()
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)

        final_event = self._build_final_event(
            final_reason=flush_reason,
            vendor_event='input_finished',
        )
        if final_event is None:
            return []

        self.finalized = True
        return [final_event]

    def _begin_next_utterance(self) -> None:
        self.utterance_index += 1
        self.utterance_start_samples = self.total_samples
        self.utterance_revision = 0
        self.last_partial_text = ''

    def _current_result(self) -> dict[str, Any]:
        if self.stream is None or self.recognizer is None:
            return {}

        result = self.recognizer.get_result(self.stream)
        if hasattr(result, 'json'):
            raw = result.json()
        else:
            raw = result
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return {'text': raw}
            return parsed if isinstance(parsed, dict) else {'text': str(parsed)}
        if isinstance(raw, dict):
            return raw
        return {'text': str(raw)}

    def _build_partial_event(self) -> dict[str, Any] | None:
        result = self._current_result()
        text = str(result.get('text') or '').strip()
        if not text or text == self.last_partial_text:
            return None

        self.utterance_revision += 1
        self.last_partial_text = text
        return {
            'type': 'transcript.partial',
            'utterance': {
                'utteranceId': self._current_utterance_id(),
                'revision': self.utterance_revision,
                'text': text,
                'startMs': self._utterance_start_ms(),
                'endMs': self._current_end_ms(),
                'isFinal': False,
                'stability': 'interim',
                'language': 'zh',
            },
            'vendor': {
                'name': 'sherpa-onnx',
                'event': 'decode_result',
            },
        }

    def _build_final_event(self, final_reason: str, vendor_event: str) -> dict[str, Any] | None:
        result = self._current_result()
        text = str(result.get('text') or '').strip()
        if not text:
            return None

        self.utterance_revision = max(self.utterance_revision + 1, 1)
        self.last_partial_text = text
        return {
            'type': 'transcript.final',
            'utterance': {
                'utteranceId': self._current_utterance_id(),
                'revision': self.utterance_revision,
                'text': text,
                'startMs': self._utterance_start_ms(),
                'endMs': self._current_end_ms(),
                'isFinal': True,
                'stability': 'stable',
                'finalReason': final_reason,
                'language': 'zh',
            },
            'vendor': {
                'name': 'sherpa-onnx',
                'event': vendor_event,
                'segment': result.get('segment'),
                'isFinal': bool(result.get('is_final', False)),
            },
        }

    def _current_utterance_id(self) -> str:
        return f'utt-{self.utterance_index}'

    def _utterance_start_ms(self) -> int:
        return samples_to_ms(self.utterance_start_samples, self.args.sample_rate)

    def _current_end_ms(self) -> int:
        return samples_to_ms(self.total_samples, self.args.sample_rate)


class BridgeError(Exception):
    def __init__(self, code: str, message: str, retriable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retriable = retriable


class SherpaBridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], handler_class, args: argparse.Namespace) -> None:
        super().__init__(server_address, handler_class)
        self.args = args
        self.sherpa_onnx = load_sherpa_onnx()


class SherpaBridgeHandler(BaseHTTPRequestHandler):
    server: SherpaBridgeHTTPServer
    protocol_version = 'HTTP/1.1'

    def do_GET(self) -> None:
        if self.path == '/healthz':
            self._write_json(
                HTTPStatus.OK,
                {
                    'ok': True,
                    'provider': 'sherpa-onnx-bridge',
                    'protocol': 'lg-asr-ws-v1',
                    'model': self.server.args.model_name,
                },
            )
            return

        if self.path != self.server.args.path:
            self.send_error(HTTPStatus.NOT_FOUND, 'Not Found')
            return

        upgrade = self.headers.get('Upgrade', '')
        websocket_key = self.headers.get('Sec-WebSocket-Key', '')
        if upgrade.lower() != 'websocket' or not websocket_key:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Expected websocket upgrade')
            return

        # Hand off this TCP connection to the manual WebSocket loop below.
        # Without forcing the HTTP server to stop its request loop, it will try
        # to parse subsequent WebSocket frames as new HTTP requests.
        self.close_connection = True
        self._handle_websocket(websocket_key)

    def log_message(self, format: str, *args: Any) -> None:
        if self.server.args.debug:
            super().log_message(format, *args)

    def _handle_websocket(self, websocket_key: str) -> None:
        accept_key = base64.b64encode(
            hashlib.sha1(f'{websocket_key}{WEBSOCKET_GUID}'.encode('utf-8')).digest()
        ).decode('ascii')

        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept_key)
        self.end_headers()

        session = BridgeSession(args=self.server.args, sherpa_onnx=self.server.sherpa_onnx)
        send_ws_json(
            self.connection,
            {
                'type': 'status',
                'status': 'connected',
                'detail': 'sherpa-onnx bridge connected',
                'bridge': {
                    'protocol': 'lg-asr-ws-v1',
                    'endpoint': f'ws://{self.server.args.host}:{self.server.args.port}{self.server.args.path}',
                    'model': self.server.args.model_name,
                },
            },
        )

        try:
            while True:
                frame = read_ws_frame(self.connection)
                if frame is None:
                    break

                opcode, payload = frame
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    send_ws_frame(self.connection, 0xA, payload)
                    continue
                if opcode != 0x1:
                    continue

                try:
                    message = json.loads(payload.decode('utf-8'))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    send_bridge_error(self.connection, 'BAD_REQUEST', 'Invalid JSON payload')
                    continue

                try:
                    should_close = self._dispatch_message(self.connection, session, message)
                except BridgeError as exc:
                    send_bridge_error(self.connection, exc.code, exc.message, retriable=exc.retriable)
                    if exc.code in {'AUTH_ERROR', 'UNSUPPORTED_PROTOCOL_VERSION'}:
                        break
                    continue
                except Exception as exc:  # pragma: no cover - defensive runtime path
                    send_bridge_error(
                        self.connection,
                        'ENGINE_RUNTIME_ERROR',
                        f'Unhandled bridge error: {exc}',
                        retriable=False,
                    )
                    break

                if should_close:
                    break
        finally:
            try:
                send_ws_close(self.connection)
            except OSError:
                pass

    def _dispatch_message(
        self,
        connection: socket.socket,
        session: BridgeSession,
        payload: dict[str, Any],
    ) -> bool:
        message_type = str(payload.get('type') or '')
        if message_type == 'session.start':
            started = session.start(payload)
            send_ws_json(connection, started)
            send_ws_json(
                connection,
                {
                    'type': 'status',
                    'status': 'listening',
                    'detail': 'sherpa-onnx bridge ready',
                    'bridge': {
                        'protocol': 'lg-asr-ws-v1',
                        'model': self.server.args.model_name,
                    },
                },
            )
            return False

        if message_type == 'audio.frame':
            for event in session.handle_audio_frame(payload):
                send_ws_json(connection, event)
            return False

        if message_type == 'audio.flush':
            for event in session.handle_flush(payload):
                send_ws_json(connection, event)
            return False

        if message_type == 'session.stop':
            send_ws_json(
                connection,
                {
                    'type': 'status',
                    'status': 'closing',
                    'detail': 'sherpa-onnx bridge stopping',
                },
            )
            send_ws_json(
                connection,
                {
                    'type': 'session.stopped',
                    'session': {
                        'sessionId': session.session_id or str(payload.get('session', {}).get('sessionId') or ''),
                    },
                },
            )
            return True

        raise BridgeError(code='BAD_REQUEST', message=f'Unsupported message type: {message_type or "unknown"}')

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status.value)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def pcm16_to_float32_list(data: bytes) -> list[float]:
    sample_count = len(data) // 2
    if sample_count == 0:
        return []
    unpacked = struct.unpack(f'<{sample_count}h', data)
    return [sample / 32768.0 for sample in unpacked]


def samples_to_ms(sample_count: int, sample_rate: int) -> int:
    return int(round((sample_count / sample_rate) * 1000))


def read_exact(connection: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = connection.recv(size - len(chunks))
        if not chunk:
            raise ConnectionError('socket closed')
        chunks.extend(chunk)
    return bytes(chunks)


def read_ws_frame(connection: socket.socket) -> tuple[int, bytes] | None:
    try:
        header = read_exact(connection, 2)
    except ConnectionError:
        return None

    first_byte, second_byte = header
    opcode = first_byte & 0x0F
    masked = bool(second_byte & 0x80)
    payload_length = second_byte & 0x7F

    if payload_length == 126:
        payload_length = struct.unpack('!H', read_exact(connection, 2))[0]
    elif payload_length == 127:
        payload_length = struct.unpack('!Q', read_exact(connection, 8))[0]

    masking_key = read_exact(connection, 4) if masked else b''
    payload = read_exact(connection, payload_length) if payload_length else b''

    if masked:
        payload = bytes(byte ^ masking_key[index % 4] for index, byte in enumerate(payload))

    return opcode, payload


def send_ws_frame(connection: socket.socket, opcode: int, payload: bytes) -> None:
    first_byte = 0x80 | (opcode & 0x0F)
    payload_length = len(payload)

    if payload_length < 126:
        header = struct.pack('!BB', first_byte, payload_length)
    elif payload_length < 65536:
        header = struct.pack('!BBH', first_byte, 126, payload_length)
    else:
        header = struct.pack('!BBQ', first_byte, 127, payload_length)

    connection.sendall(header + payload)


def send_ws_json(connection: socket.socket, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    send_ws_frame(connection, 0x1, body)


def send_ws_close(connection: socket.socket) -> None:
    send_ws_frame(connection, 0x8, b'')


def send_bridge_error(
    connection: socket.socket,
    code: str,
    message: str,
    retriable: bool = False,
) -> None:
    send_ws_json(
        connection,
        {
            'type': 'error',
            'error': {
                'code': code,
                'message': message,
                'retriable': retriable,
            },
        },
    )


def main() -> int:
    args = parse_args()
    ensure_model_files(args)

    server = SherpaBridgeHTTPServer((args.host, args.port), SherpaBridgeHandler, args)

    print(f'[sherpa-onnx-bridge] listening on ws://{args.host}:{args.port}{args.path}')
    print(f'[sherpa-onnx-bridge] health check: http://{args.host}:{args.port}/healthz')
    print(f'[sherpa-onnx-bridge] model: {args.model_name}')
    print(f'[sherpa-onnx-bridge] encoder: {args.encoder}')
    print(f'[sherpa-onnx-bridge] decoder: {args.decoder}')
    print(f'[sherpa-onnx-bridge] tokens: {args.tokens}')
    sys.stdout.flush()

    shutdown_complete = threading.Event()

    def handle_shutdown(*_args: Any) -> None:
        if not shutdown_complete.is_set():
            shutdown_complete.set()
            server.shutdown()

    try:
        if hasattr(signal := __import__('signal'), 'SIGINT'):
            signal.signal(signal.SIGINT, handle_shutdown)
            signal.signal(signal.SIGTERM, handle_shutdown)
    except ValueError:
        pass

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
