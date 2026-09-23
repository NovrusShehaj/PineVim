"""Disposable real Pi/tmux feasibility checks. No personal resources or providers."""
import os, pathlib, tempfile, subprocess, json, time, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
PI = shutil.which('pi')
if not PI: raise SystemExit('Install Pi 0.87.1 on PATH before the installed-Pi feasibility test.')

def wait_for(predicate):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        result = predicate()
        if result: return result
        time.sleep(.05)
    raise AssertionError('fixture deadline exceeded')

with tempfile.TemporaryDirectory(prefix='pv0-') as root:
    p = pathlib.Path(root)
    env = {k:v for k,v in os.environ.items() if k in ('PATH','LANG','LC_ALL','TMPDIR')}
    env.update(HOME=root, XDG_CONFIG_HOME=root+'/config', XDG_DATA_HOME=root+'/data', XDG_STATE_HOME=root+'/state', PI_CODING_AGENT_DIR=root+'/agent', TERM='xterm-256color', PI_SKIP_VERSION_CHECK='1', PINEVIM_FIXTURE_RECORD=root+'/events')
    (p/'agent').mkdir()
    (p/'agent'/'keybindings.json').write_text('{"app.model.select":[]}')
    (p/'agent'/'settings.json').write_text('{"quietStartup":true,"packages":[],"skills":[],"checkForUpdates":false}')
    config = p/'tmux.conf'
    config.write_text('set -g default-terminal tmux-256color\nset -g extended-keys on\nset -g extended-keys-format csi-u\nset -g remain-on-exit on\nset -g status on\nset -g prefix F12\nunbind -a -T prefix\nbind F12 send-prefix\nbind i display-message PINEVIM-F12\n')
    def tm(*args):
        return subprocess.check_output(['tmux','-S',root+'/t','-f',str(config),*map(str,args)],env=env,text=True,stderr=subprocess.PIPE).strip()
    def events():
        return [json.loads(x) for x in (p/'events').read_text().splitlines()] if (p/'events').exists() else []
    def command(text):
        tm('send-keys','-t',agent,'-l',text)
        tm('send-keys','-t',agent,'Enter')
    try:
        agent=tm('new-session','-d','-x','80','-y','24','-P','-F','#{pane_id}','-c',root,PI,'--extension',str(ROOT/'tests/fixtures/phase0.ts'))
        start=wait_for(lambda: next((e for e in events() if e['event']=='start'),None))
        assert any(c['name']=='ide' and c['path']==str(ROOT/'tests/fixtures/phase0.ts') for c in start['commands'])
        command('/ide')
        wait_for(lambda: any(e['event']=='ide' for e in events()))
        tm('send-keys','-t',agent,'C-l')
        wait_for(lambda: any(e['event']=='picker-open' for e in events()))
        tm('send-keys','-t',agent,'Escape')
        wait_for(lambda: any(e['event']=='picker-close' for e in events()))
        command('ordinary fixture input')
        wait_for(lambda: any(e['event']=='input' for e in events()))
        editor=tm('split-window','-h','-b','-t',agent,'-P','-F','#{pane_id}','-c',root,'nvim','--clean','-i','NONE')
        ids=tm('list-panes','-F','#{pane_id}:#{pane_pid}')
        for width,height in [(120,30),(101,24),(100,24),(80,24),(60,16),(40,10)]*3:
            tm('resize-window','-t',agent,'-x',width,'-y',height-1)
            tm('select-pane','-t',editor)
            if tm('display-message','-p','-t',agent,'#{window_zoomed_flag}')=='0': tm('resize-pane','-Z','-t',editor)
            assert tm('list-panes','-F','#{pane_id}:#{pane_pid}')==ids
            assert all(int(n)>0 for line in tm('list-panes','-F','#{pane_width} #{pane_height}').splitlines() for n in line.split())
        tm('resize-window','-t',agent,'-x','120','-y','29')
        tm('resize-pane','-Z','-t',editor)
        tm('resize-pane','-t',agent,'-x','42')
        assert tm('display-message','-p','-t',agent,'#{pane_width}')=='42'
        command('/reload')
        wait_for(lambda: len([e for e in events() if e['event']=='start'])>=2)
        print('PASS real Pi public commands, custom editor/picker, reload; live Pi/Nvim IDs across 18 geometry/zoom transitions')
        tm('kill-session')
        agent=tm('new-session','-d','-x','80','-y','24','-P','-F','#{pane_id}','-c',root,PI,'--extension',str(ROOT/'tests/fixtures/phase0.ts'),'--extension',str(ROOT/'tests/fixtures/collision.ts'))
        start=wait_for(lambda: next((e for e in reversed(events()) if e['event']=='start' and any(c['name'].startswith('ide:') or c['name'].startswith('ide-') for c in e['commands'])),None))
        print('PASS public collision metadata:', json.dumps(start['commands']))
    finally:
        try: tm('kill-server')
        except subprocess.CalledProcessError: pass
