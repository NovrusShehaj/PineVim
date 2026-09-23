"""Attached PTY tests; synthetic keyboard bytes do not certify physical keyboards/clipboards."""
import os, sys, pathlib, tempfile, subprocess, json, time, pty, fcntl, termios, struct, select, signal, shutil
CAPTURE={}
ROOT=pathlib.Path(__file__).resolve().parents[2]

def terminal(argv,env,columns=120,rows=30):
    pid,fd=pty.fork()
    if pid==0: os.execvpe(argv[0],argv,env)
    fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
    os.set_blocking(fd,False)
    return pid,fd

def drain(fd):
    try:
        while select.select([fd],[],[],0)[0]:
            data=os.read(fd,65536)
            if not data:break
            CAPTURE[fd]=(CAPTURE.get(fd,b'')+data)[-4000:]
    except OSError: pass

def wait(check,fd,seconds=20):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        drain(fd)
        try:
            result=check()
            if result:return result
        except (FileNotFoundError,json.JSONDecodeError):pass
        time.sleep(.03)
    print('Terminal fixture timed out; captured synthetic screen omitted.',flush=True)
    raise AssertionError('Attached terminal condition deadline exceeded')

def scenario(nested=False,benchmark=False,fullscreen=False):
  with tempfile.TemporaryDirectory(prefix='pv-tty-') as root:
    base=pathlib.Path(root).resolve();workspace=base/'workspace';workspace.mkdir();agent=base/'agent';agent.mkdir()
    config=base/'config'/'pinevim';config.mkdir(parents=True)
    (config/'config.json').write_text(json.dumps({'pi':str(ROOT/'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),'nvim':shutil.which('nvim')}))
    (agent/'settings.json').write_text(json.dumps({'tuiMode':'fullscreen' if fullscreen else 'regular','quietStartup':True,'packages':[],'skills':[],'extensions':[str(ROOT/'tests/fixtures/provider.ts'),str(ROOT/'tests/fixtures/keys.ts')],'defaultProvider':'pine-fixture','defaultModel':'one'}))
    env={'PATH':os.environ['PATH'],'HOME':str(base),'XDG_CONFIG_HOME':str(base/'config'),'XDG_STATE_HOME':str(base/'state'),'XDG_DATA_HOME':str(base/'data'),'PI_CODING_AGENT_DIR':str(agent),'PI_SKIP_VERSION_CHECK':'1','TERM':'xterm-256color','LANG':'en_US.UTF-8','PINEVIM_LOG_LEVEL':'debug','PINEVIM_FIXTURE_KEYS':str(base/'keys.jsonl'),'PINEVIM_FIXTURE_RECORD':str(base/'provider-events')}
    # Real nvim default invocation, isolated HOME: normal startup contract without user's plugins.
    cli=['node',str(ROOT/'dist/cli.js'),str(workspace)]
    outer=str(base/'outer.sock')
    if nested:
      outer_config=base/'outer.conf';outer_config.write_text('set -g extended-keys on\nset -g extended-keys-format csi-u\n')
      subprocess.check_call(['tmux','-S',outer,'-f',str(outer_config),'new-session','-d','-x','120','-y','30',*cli],env=env)
      cli=['tmux','-S',outer,'attach-session']
    launched=time.monotonic()
    pid,fd=terminal(cli,env);runtime=None;metadata=None
    def current():
      paths=list((base/'state'/'pinevim').glob('*/state.json'))
      return json.loads(paths[0].read_text()) if paths else None
    try:
      metadata=wait(lambda: (m if (m:=current()) and m['state']['bridge'] else None),fd)
      if not benchmark:print('attached ready',nested,flush=True)
      runtime=metadata['runtime'];agent_pid=metadata['state']['agent']['pid']
      logs=next((base/'state'/'pinevim').glob('*/controller.log'))
      startup=next(e['duration'] for e in map(json.loads,logs.read_text().splitlines()) if e['event']=='startup')
      if benchmark:return {'prelaunchMs':startup,'launchToBridgeMs':(time.monotonic()-launched)*1000}
      print('prefix ide',flush=True);os.write(fd,b'\x1b[24~i')
      metadata=wait(lambda: (m if (m:=current()) and m['state']['mode']=='IDE_WITH_AGENT' else None),fd)
      editor_pid=metadata['state']['editor']['pid']
      os.write(fd,b'\x1b[24~a')
      wait(lambda: current()['state']['mode']=='IDE_FOCUS',fd)
      os.write(fd,b'\x1b[24~a')
      wait(lambda: current()['state']['mode']=='IDE_WITH_AGENT' and current()['state']['focus']=='agent',fd)
      os.write(fd,b'\x1b[24~\x1b[24~')
      wait(lambda:(base/'keys.jsonl').exists() and '1b5b32347e' in (base/'keys.jsonl').read_text(),fd)
      os.write(fd,b'\x1b[200~line one\nline two\x1b[201~')
      wait(lambda:'line two' in (base/'keys.jsonl').read_text(),fd)
      os.write(fd,b'\x1b[13;2u')
      wait(lambda:'1b5b31333b3275' in (base/'keys.jsonl').read_text(),fd)
      print('literal F12, bracketed paste, CSI-u Shift+Enter passed',flush=True)
      print('resizing',flush=True);fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
      os.kill(pid,signal.SIGWINCH)
      wait(lambda: current()['state']['compact'],fd)
      fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',30,120,0,0));os.kill(pid,signal.SIGWINCH)
      wait(lambda: not current()['state']['compact'],fd)
      assert current()['state']['agent']['pid']==agent_pid
      assert current()['state']['editor']['pid']==editor_pid
      if not nested:
        print('crash recovery',flush=True)
        os.kill(pid,signal.SIGKILL);os.close(fd)
        old_pid=pid
        pid,fd=terminal(['node',str(ROOT/'dist/cli.js'),'--resume',str(workspace)],env)
        recovered=wait(lambda:(m if (m:=current()) and m['state']['bridge'] and m['state']['epoch']!=metadata['state']['epoch'] else None),fd)
        assert recovered['state']['agent']['pid']==agent_pid
        assert recovered['state']['editor']['pid']==editor_pid
        os.waitpid(old_pid,os.WNOHANG)
      # Create a persisted synthetic Pi session before explicit crash/retry.
      os.write(fd,b'\x03');time.sleep(.1);drain(fd);os.write(fd,b'synthetic request');time.sleep(.1);os.write(fd,b'\r')
      wait(lambda:current()['state']['busy'],fd)
      wait(lambda:not current()['state']['busy'],fd)
      session_id=current()['state']['sessionId']
      requests=(base/'provider-events').read_text().count('"event":"request"')
      os.kill(agent_pid,signal.SIGKILL)
      wait(lambda:not current()['state']['agent']['alive'],fd)
      os.write(fd,b'\x1b[24~r');time.sleep(.15);drain(fd);os.write(fd,b'y')
      retried=wait(lambda:(m if (m:=current()) and m['state']['bridge'] and m['state']['agent']['pid']!=agent_pid else None),fd)
      assert retried['state']['editor']['pid']==editor_pid
      assert retried['state']['sessionId']==session_id
      assert (base/'provider-events').read_text().count('"event":"request"')==requests
      # Quit must focus the live editor; this test's blank editor then exits natively.
      os.write(fd,b'\x1b[24~q');wait(lambda:current()['state']['focus']=='editor',fd)
      os.write(fd,b':qa\r');wait(lambda:current()['state']['mode']=='CHAT_ONLY',fd)
      os.write(fd,b'busy cancellation fixture\r');wait(lambda:current()['state']['busy'],fd)
      CAPTURE[fd]=b'';os.write(fd,b'\x1b[24~q');wait(lambda:b'Cancel active Pi' in CAPTURE.get(fd,b''),fd);os.write(fd,b'n');time.sleep(.1);drain(fd)
      assert current()['state']['agent']['alive']
      CAPTURE[fd]=b'';os.write(fd,b'\x1b[24~q');wait(lambda:b'Cancel active Pi' in CAPTURE.get(fd,b''),fd);os.write(fd,b'y')
      wait(lambda:current() is None,fd)
      assert '"event":"abort"' in (base/'provider-events').read_text()
      print('PASS confirmed Pi retry: same editor/session, no replay; safe editor quit and busy cancellation',flush=True)
      print('PASS attached '+('nested tmux' if nested else 'PTY + controller SIGKILL/resume')+': real F12 escape routing, resize, same Pi/Nvim PIDs')
      return startup
    except Exception:
      m=current()
      if m:print('Failure state:',m['state']['lifecycle'],m['state']['busy'],m['state']['bridge'],m['state']['agent']['alive'],flush=True)
      if (base/'provider-events').exists():print('Fixture events:',[json.loads(line)['event'] for line in (base/'provider-events').read_text().splitlines()],flush=True)
      raise
    finally:
      try:os.kill(pid,signal.SIGTERM)
      except ProcessLookupError:pass
      try:os.close(fd)
      except OSError:pass
      if runtime:subprocess.run(['tmux','-S',runtime+'/tmux.sock','kill-server'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
      if nested:subprocess.run(['tmux','-S',outer,'kill-server'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
      try:
        end=time.monotonic()+3
        while time.monotonic()<end:
          if os.waitpid(pid,os.WNOHANG)[0]:break
          time.sleep(.05)
        else:os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
      except (ChildProcessError,ProcessLookupError):pass
      if runtime:shutil.rmtree(runtime,ignore_errors=True)

def startup_rejections():
  with tempfile.TemporaryDirectory(prefix='pv-startup-') as root:
    base=pathlib.Path(root).resolve();config=base/'config'/'pinevim';config.mkdir(parents=True)
    env={'PATH':os.environ['PATH'],'HOME':str(base),'XDG_CONFIG_HOME':str(base/'config'),'XDG_STATE_HOME':str(base/'state'),'TERM':'xterm-256color'}
    cli=['node',str(ROOT/'dist/cli.js'),str(base)]
    non_tty=subprocess.run(cli,env=env,capture_output=True)
    assert non_tty.returncode==1 and b'interactive terminal' in non_tty.stderr
    cases=[('size',59,15,'xterm-256color',None,b'at least 60'),('dumb',120,30,'dumb',None,b'interactive terminal'),('config',120,30,'xterm-256color','{',b'Invalid JSON'),('dependency',120,30,'xterm-256color',json.dumps({'pi':str(base/'absent')}),b'unavailable')]
    for name,columns,rows,term,content,expected in cases:
      if content is not None:(config/'config.json').write_text(content)
      env['TERM']=term
      pid,fd=terminal(cli,env,columns,rows);CAPTURE[fd]=b''
      try:
        end=time.monotonic()+10
        while time.monotonic()<end:
          drain(fd);ended,status=os.waitpid(pid,os.WNOHANG)
          if ended:break
          time.sleep(.02)
        else:raise AssertionError('Startup rejection timed out: '+name)
        drain(fd)
        assert os.waitstatus_to_exitcode(status)==1 and expected in CAPTURE[fd],name
        assert not list((base/'state').glob('pinevim/*/state.json')),name
      finally:os.close(fd)
    print('PASS CLI rejects non-TTY, undersize, TERM=dumb, malformed config and missing Pi before child startup',flush=True)

if __name__=='__main__':
  if '--benchmark' in sys.argv:print(json.dumps([scenario(benchmark=True) for _ in range(20)]))
  else:
    startup_rejections();scenario();scenario(nested=True);scenario(fullscreen=True)
