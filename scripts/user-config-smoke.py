"""Explicit personal-configuration smoke. No prompt submission, provider completions, or PTY logging.
Pi's picker may refresh its own catalog. Normal application-managed writes remain possible.
"""
import os,sys,pathlib,tempfile,time,signal,json,hashlib,shutil,fcntl,termios,struct
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tests'/'terminal'))
from transport import terminal,wait,drain,CAPTURE,ROOT

def config_snapshot():
    root=pathlib.Path.home()/'.config'/'nvim'
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}

def main():
    before=config_snapshot()
    resume=len(sys.argv)>1
    root=pathlib.Path(sys.argv[1]).resolve() if resume else pathlib.Path(tempfile.mkdtemp(prefix='pv-personal-')).resolve();workspace=root/'workspace'
    if not resume:workspace.mkdir()
    env=dict(os.environ);env.update(XDG_STATE_HOME=str(root/'state'),PINEVIM_LOG_LEVEL='debug',TERM='xterm-256color')
    pid,fd=terminal(['node',str(ROOT/'dist/cli.js'),*(['--resume'] if resume else []),str(workspace)],env)
    def current():
        paths=list((root/'state'/'pinevim').glob('*/state.json'))
        return json.loads(paths[0].read_text()) if paths else None
    complete=False
    try:
        metadata=wait(lambda:(m if (m:=current()) and m['state']['bridge'] and m['state']['lifecycle']=='running' and m['clientPid'] else None),fd,40)
        wait(lambda:b'F12' in CAPTURE.get(fd,b''),fd)
        os.write(fd,b'\x1b');time.sleep(.6);drain(fd);os.write(fd,b'\x1b');time.sleep(.6);drain(fd)
        agent_pid=metadata['state']['agent']['pid']
        CAPTURE[fd]=b'';os.write(fd,b'\x0c')
        wait(lambda:b'Models' in CAPTURE.get(fd,b'') and b'providers' in CAPTURE.get(fd,b''),fd,30)
        os.write(fd,b'\x1b');time.sleep(.6);drain(fd);os.write(fd,b'\x1b');time.sleep(.6);drain(fd)
        for columns in [80,60]:
            fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',24,columns,0,0));os.kill(pid,signal.SIGWINCH)
            wait(lambda:current()['state']['geometry']['columns']==columns,fd)
            CAPTURE[fd]=b'';os.write(fd,b'\x0c')
            wait(lambda:b'Models' in CAPTURE.get(fd,b'') and b'providers' in CAPTURE.get(fd,b''),fd,30)
            os.write(fd,b'\x1b');time.sleep(.6);drain(fd);os.write(fd,b'\x1b');time.sleep(.6);drain(fd)
        fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',30,120,0,0));os.kill(pid,signal.SIGWINCH)
        wait(lambda:current()['state']['geometry']['columns']==120,fd)
        os.write(fd,b'\x1b[24~i');metadata=wait(lambda:(m if (m:=current()) and m['state']['editor'] and m['state']['editor']['alive'] else None),fd,40)
        editor_pid=metadata['state']['editor']['pid'];time.sleep(1);drain(fd)
        os.write(fd,b'\x1b[24~\t');wait(lambda:current()['state']['focus']=='agent',fd)
        CAPTURE[fd]=b'';os.write(fd,b'\x0c')
        wait(lambda:b'Models' in CAPTURE.get(fd,b'') and b'providers' in CAPTURE.get(fd,b''),fd,30)
        os.write(fd,b'\x1b');time.sleep(.6);drain(fd);os.write(fd,b'\x1b');time.sleep(.6);drain(fd)
        os.write(fd,b'\x1b[24~\t');wait(lambda:current()['state']['focus']=='editor',fd)
        for key,mode in [(b'a','IDE_FOCUS'),(b'a','IDE_WITH_AGENT'),(b'c','CHAT_ONLY'),(b'i','IDE_WITH_AGENT')]:
            os.write(fd,b'\x1b[24~'+key);wait(lambda:current()['state']['mode']==mode,fd)
            assert current()['state']['agent']['pid']==agent_pid and current()['state']['editor']['pid']==editor_pid
        # Only the new, blank smoke-test editor is addressed. Production never injects editor commands.
        os.write(fd,b':qa\r');wait(lambda:current()['state']['mode']=='CHAT_ONLY',fd)
        os.write(fd,b'\x1b[24~q');wait(lambda:current() is None,fd)
        complete=True
        changed=[p for p in set(before)|set(config_snapshot()) if before.get(p)!=config_snapshot().get(p)]
        print(json.dumps({'personalPiHandshake':'PASS','actualCtrlLPicker':'PASS semantic Models/providers rendering at 120/80/60 columns and the wide split agent pane','normalNeovim':'PASS startup and PID continuity','viewContinuity':'PASS','normalQuit':'PASS','nvimConfigChangedFiles':changed,'providerCompletionInvoked':False,'limits':'PTY smoke does not certify physical keyboard, fonts, colors or clipboard.'}))
    finally:
        try:os.kill(pid,signal.SIGTERM)
        except ProcessLookupError:pass
        os.close(fd)
        if complete:shutil.rmtree(root)
        else:print('Smoke interrupted; live children preserved. Recover with node dist/cli.js --resume '+str(workspace)+' using XDG_STATE_HOME='+str(root/'state'))

if __name__=='__main__':main()
