"""Exercise the real web app, OpenClaw and Tencent plugin using local synthetic transports."""
import base64
import json
import os
import signal
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OWNER = 'synthetic@im.wechat'
PASS = 'synthetic-test-password'
IMAGE = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=')
drafts, models, cursors, pins = [], [], [], []
qr_requests = 0

class Backend(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def blob(self, body, mime):
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def reply(self, value):
        self.blob(json.dumps(value).encode(), 'application/json')

    def route(self):
        global qr_requests
        url = urlsplit(self.path)
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        if url.path.endswith('/get_bot_qrcode'):
            qr_requests += 1
            self.reply({'qrcode':'fixture', 'qrcode_img_content':'https://fixture.invalid/bind'})
        elif url.path.endswith('/get_qrcode_status'):
            code = parse_qs(url.query).get('verify_code', [''])[0]
            if code:
                pins.append(code)
            if code == '654321':
                self.reply({'status':'confirmed','baseurl':origin,'ilink_bot_id':'fixture@im.bot',
                            'bot_token':'synthetic-bot-token','ilink_user_id':OWNER})
            elif not try_pin.is_set():
                self.reply({'status':'wait'})
            else:
                self.reply({'status':'need_verifycode'})
        elif url.path.endswith('/getupdates'):
            n = int(body.get('get_updates_buf') or 0)
            cursors.append(n)
            if n >= 3:
                time.sleep(.4)
                return self.reply({'ret':0,'msgs':[],'get_updates_buf':'3'})
            item = {'type':1,'text_item':{'text':'我想约对方喝咖啡，怎么回？'}}
            sender = OWNER
            if n == 0:
                sender = 'unbound@im.wechat'
                item['text_item']['text'] = 'UNBOUND_FIXTURE_MESSAGE'
            if n == 2:
                item = {'type':2,'image_item':{'media':{'full_url':origin+'/image'}}}
            msg = {'message_id':str(n+1),'message_type':1,'message_state':2,'from_user_id':sender,
                   'to_user_id':'fixture@im.bot','context_token':'test-context','create_time_ms':int(time.time()*1000),'item_list':[item]}
            self.reply({'ret':0,'msgs':[msg],'get_updates_buf':str(n+1)})
        elif url.path.endswith('/chat/completions'):
            assert self.headers.get('Authorization') == 'Bearer synthetic-model-key'
            text = json.dumps(body,ensure_ascii=False)
            assert 'UNBOUND_FIXTURE_MESSAGE' not in text
            models.append(('狗头军师' in text,'喝咖啡' in text,'data:image/' in text))
            def chunk(delta, reason):
                return 'data: ' + json.dumps({'id':'local','object':'chat.completion.chunk','model':'fixture',
                    'choices':[{'index':0,'delta':delta,'finish_reason':reason}]}) + '\n\n'
            self.blob((chunk({'role':'assistant','content':'合成测试回复'},None)+chunk({},'stop')+'data: [DONE]\n\n').encode(),'text/event-stream')
        elif url.path.endswith('/sendmessage'):
            msg = body['msg']
            if '合成测试回复' in str(msg.get('item_list')):
                drafts.append(msg['to_user_id'])
            self.reply({'ret':0})
        elif url.path == '/image':
            self.blob(IMAGE,'image/png')
        else:
            self.reply({'ret':0})
    do_GET = route
    do_POST = route

def wait_for(fn, timeout=120):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            result = fn()
            if result: return result
        except (OSError, ConnectionError):
            pass
        if proc.poll() is not None:
            raise RuntimeError('worker exited early')
        time.sleep(.35)
    raise TimeoutError('timed out waiting for ' + str(fn))

def request(route, body=None, auth=True, mutation=True):
    headers = {}
    if auth: headers['Authorization'] = 'Basic ' + base64.b64encode(('admin:' + PASS).encode()).decode()
    if mutation: headers['X-ClawBot-Action'] = '1'
    req = Request(web + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with urlopen(req, timeout=3) as response: return response.status,response.read()
    except HTTPError as err:
        return err.code, err.read()

def status(): return json.loads(request('/api/status')[1])

def stop():
    if proc.poll() is None:
        os.killpg(proc.pid,signal.SIGTERM)
        try: proc.wait(15)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid,signal.SIGKILL)
            proc.wait()

try_pin = threading.Event()
backend = ThreadingHTTPServer(('127.0.0.1',0), Backend)
origin = 'http://127.0.0.1:' + str(backend.server_port)
threading.Thread(target=backend.serve_forever,daemon=True).start()
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    port = sock.getsockname()[1]
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    gateway_port = sock.getsockname()[1]
web = 'http://127.0.0.1:' + str(port)
with tempfile.TemporaryDirectory(prefix='junshi-test-') as temp:
    log = Path(temp)/'test.log'
    env = {**os.environ, 'CLAWBOT_GATEWAY_PORT':str(gateway_port), 'PORT':str(port),'BIND_ADDRESS':'127.0.0.1','ADMIN_PASSWORD':PASS,
           'MODEL_API_KEY':'synthetic-model-key','MODEL_BASE_URL':origin+'/v1','MODEL_ID':'fixture',
           'CLAWBOT_DATA_DIR':temp,'TEST_WEIXIN_ORIGIN':origin,
           'NODE_OPTIONS':'--import='+(ROOT/'test/redirect-login.mjs').as_uri()}
    def launch():
        with log.open('a') as out:
            return subprocess.Popen(['node','scripts/worker.mjs'],cwd=ROOT,env=env,stdout=out,stderr=out,start_new_session=True)
    proc = launch()
    try:
        wait_for(lambda: status().get('phase') == 'idle', 240)
        assert request('/api/status',auth=False)[0] == 401
        assert request('/api/local-session',{},auth=False)[0] == 401
        assert request('/api/bind',{},mutation=False)[0] == 403
        assert request('/api/bind',{})[0] == 202
        wait_for(lambda: (status().get('qr') or '').startswith('data:image/png;base64,'))
        request('/api/bind',{})
        try_pin.set()
        wait_for(lambda: status()['phase'] == 'pin')
        assert request('/api/pin',{'pin':'654321'})[0] == 202
        wait_for(lambda: status()['phase'] == 'online')
        wait_for(lambda: len(drafts) == 2)
        assert drafts == [OWNER, OWNER] and len(models) == 2 and all(x[0] for x in models)
        assert models[0][1] and models[1][2] and pins == ['654321']
        stop()
        checkpoint = len(cursors)
        # Restart on loopback using the local launcher's browser-ticket flow.
        env['CLAWBOT_LOCAL'] = '1'
        proc = launch()
        wait_for(lambda: status()['phase'] == 'online')
        wait_for(lambda: len(cursors) > checkpoint)
        assert request('/',auth=False)[0] == 200
        assert request('/api/status',auth=False)[0] == 401
        ticket_req = Request(web + '/api/local-session',data=b'', headers={'X-ClawBot-Ticket':PASS})
        with urlopen(ticket_req) as response:
            cookie = response.headers['Set-Cookie'].split(';')[0]
        with urlopen(Request(web + '/api/status',headers={'Cookie':cookie})) as response:
            assert json.load(response)['phase'] == 'online'
        for headers in [{'Host':'bogus.invalid'}, {'Origin':'https://foreign.invalid'}]:
            try:
                urlopen(Request(web + '/api/status',headers={'Cookie':cookie, **headers}))
                raise AssertionError('foreign host/origin unexpectedly accepted')
            except HTTPError as err:
                assert err.code == 403
        assert min(cursors[checkpoint:]) == 3 and qr_requests == 1 and len(drafts) == 2
        assert 'https://fixture.invalid/bind' not in log.read_text()
        print('PASS protected QR, PIN, owner filtering, text/image round trips and restart from saved cursor')
    except Exception:
        print(log.read_text()[-5000:])
        raise
    finally:
        stop()
        backend.shutdown()
