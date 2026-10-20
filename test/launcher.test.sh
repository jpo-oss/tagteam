#!/bin/sh
# Launcher tests: sh test/launcher.test.sh (TEST_SH=dash runs the launcher under another shell)
cd "$(dirname "$0")/.." || exit 1
repo=$(pwd)
fails=0
tmp=$(mktemp -d)
unset TAGTEAM_STALL
trap 'rm -rf "$tmp"' EXIT

setup() {
  case_dir="$tmp/$1"
  mkdir -p "$case_dir/bin" "$case_dir/home/state" "$case_dir/fake"
  ln -s "$repo/test/fake-claude" "$case_dir/bin/claude"
  : > "$case_dir/fake/log"
}

# launch_lines (one argument per line) beats launch_args (split on spaces); VAR=value words go to the environment.
launch() {
  (
    unset CLAUDE_CONFIG_DIR
    for kv in "$@"; do export "${kv?}"; done
    export PATH="$case_dir/bin:$PATH" TAGTEAM_HOME="$case_dir/home" FAKE_DIR="$case_dir/fake"
    if [ -n "$launch_lines" ]; then
      IFS='
'
      set -f
      # shellcheck disable=SC2086
      set -- $launch_lines
    else
      # shellcheck disable=SC2086
      set -- ${launch_args:---model opus}
    fi
    "${TEST_SH:-sh}" "$repo/bin/tagteam" "$@" </dev/null >"$case_dir/out" 2>&1
  )
}

it() { name=$1; }
pass() { echo "ok   $name"; }
fail() {
  echo "FAIL $name"
  sed 's/^/     /' "$case_dir/fake/log" "$case_dir/out"
  fails=$((fails + 1))
}

line() { sed -n "${1}p" "$case_dir/fake/log"; }
args_are() {
  n=$1
  shift
  printf '%s\n' "$@" | cmp -s - "$case_dir/fake/args-$n"
}
field() { line "$1" | tr ' ' '\n' | sed -n "s/^$2=//p"; }
runs() { [ "$(wc -l < "$case_dir/fake/log")" -eq "$1" ]; }
no_leftovers() {
  for f in "$case_dir"/home/state/run-* "$case_dir"/home/state/switch-*; do
    [ -e "$f" ] && return 1
  done
  return 0
}
elapsed() { echo $(($(field 2 t) - $(field 1 t))); }

setup exit-code
echo "$case_dir/A" > "$case_dir/home/state/active-dir"
echo 'exit 3' > "$case_dir/fake/mode-1"
launch; code=$?
it 'exits with claude code when no switch is requested'
if [ "$code" = 3 ] && runs 1; then pass; else fail; fi
it 'first run uses active-dir and original args'
if [ "$(field 1 cfg)" = "$case_dir/A" ] && args_are 1 --model opus; then pass; else fail; fi
it 'run file names the dir while claude runs'
if line 1 | grep -q "runfile=dir=$case_dir/A pid="; then pass; else fail; fi
it 'run file removed after exit'
if no_leftovers; then pass; else fail; fi

setup switch
echo "$case_dir/A" > "$case_dir/home/state/active-dir"
echo switch > "$case_dir/fake/mode-1"
# shellcheck disable=SC2016 # literal on purpose: the launcher must not expand it
handover='Don'"'"'t stop: "go" $(touch pwned) `touch pwned` * ok'
printf 'session=s1\ntarget_label=b\ntarget_dir=%s\nresume_at=\nreason=limit\nhandover=%s\n' "$case_dir/B" "$handover" > "$case_dir/fake/switch"
launch; code=$?
it 'switch file consumed and second exit code returned'
if [ "$code" = 0 ] && runs 2 && no_leftovers; then pass; else fail; fi
it 'relaunches on target dir with resume and handover'
if [ "$(field 2 cfg)" = "$case_dir/B" ] && args_are 2 --resume s1 "$handover" --model opus; then pass; else fail; fi
it 'handover with quotes, globs and substitutions arrives as one unchanged argument'
if [ "$(sed -n 3p "$case_dir/fake/args-2")" = "$handover" ] && [ ! -e pwned ] && [ ! -e "$case_dir/pwned" ]; then pass; else fail; fi
it 'relaunch rewrites the run file'
if line 2 | grep -q "runfile=dir=$case_dir/B pid="; then pass; else fail; fi

check_dropped() {
  setup "drops-$1"
  echo 'switch' > "$case_dir/fake/mode-1"
  printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
  launch_args="--dangerously-skip-permissions $2"
  launch
  it "relaunch drops $2"
  if args_are 2 --resume s1 go --dangerously-skip-permissions; then pass; else fail; fi
  launch_args=
}
check_dropped continue --continue
check_dropped c -c
check_dropped r-value '-r old'
check_dropped resume-eq --resume=old
check_dropped session-id '--session-id x'
check_dropped fork --fork-session
check_dropped resume-bare --resume
check_dropped from-pr '--from-pr 12'

check_dropped session-id-eq --session-id=x
check_dropped from-pr-eq --from-pr=7
check_dropped teleport --teleport
check_dropped teleport-value '--teleport t1'
check_dropped teleport-eq --teleport=t1

setup after-dashdash
echo 'switch' > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch_lines='--model
opus
-c
--
-c
a b
--resume'
launch
it 'args after -- are untouched and values with spaces survive'
if args_are 2 --resume s1 go --model opus -- -c 'a b' --resume; then pass; else fail; fi
launch_lines=

setup spaces
echo 'switch' > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch_lines='-p
hello world
--continue'
launch
it 'a value with spaces arrives as one argument'
if args_are 2 --resume s1 go -p 'hello world'; then pass; else fail; fi
launch_lines=

setup keeps-order
echo 'switch' > "$case_dir/fake/mode-1"
printf 'session=\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch_args='--model opus -c --resume --effort high'
launch
it 'fresh relaunch drops session flags and keeps the rest in order'
if args_are 2 --model opus --effort high; then pass; else fail; fi

setup first-keeps
launch_args='--continue --model opus'
launch
it 'first launch keeps --continue'
if args_are 1 --continue --model opus; then pass; else fail; fi
launch_args=

setup no-conversation
echo switch > "$case_dir/fake/mode-1"
printf 'session=\ntarget_label=b\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch; code=$?
it 'a switch with no conversation starts claude fresh on the target with the original args'
if [ "$code" = 0 ] && runs 2 && [ "$(field 2 cfg)" = "$case_dir/B" ] && args_are 2 --model opus && no_leftovers; then pass; else fail; fi

setup resume-fails
echo switch > "$case_dir/fake/mode-1"
echo 'exit 1' > "$case_dir/fake/mode-2"
printf 'session=s1\ntarget_label=b\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch; code=$?
it 'a resume that fails at once is followed by one fresh start on the target'
if [ "$code" = 0 ] && runs 3 && args_are 2 --resume s1 go --model opus && args_are 3 --model opus &&
  [ "$(field 3 cfg)" = "$case_dir/B" ] && grep -q 'could not resume' "$case_dir/out" && no_leftovers; then pass; else fail; fi

setup fresh-fails
echo switch > "$case_dir/fake/mode-1"
echo 'exit 1' > "$case_dir/fake/mode-2"
echo 'exit 4' > "$case_dir/fake/mode-3"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch; code=$?
it 'the fresh start is tried once, and its exit code is returned'
if [ "$code" = 4 ] && runs 3; then pass; else fail; fi

setup resume-interrupted
echo switch > "$case_dir/fake/mode-1"
echo 'exit 130' > "$case_dir/fake/mode-2"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch; code=$?
it 'a resumed claude that quits at once with another code is not restarted'
if [ "$code" = 130 ] && runs 2 && ! grep -q 'could not resume' "$case_dir/out" && no_leftovers; then pass; else fail; fi

setup stall
echo "$case_dir/A" > "$case_dir/home/state/active-dir"
echo hang > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch TAGTEAM_STALL=1
it 'stalled claude gets SIGTERM within 3s and relaunch follows'
if [ -s "$case_dir/fake/signals" ] && [ "$(elapsed)" -le 3 ] && [ "$(field 2 cfg)" = "$case_dir/B" ]; then pass; else fail; fi

setup stall-default
# shellcheck disable=SC2016 # literal on purpose: the stub sleep expands these when it runs
printf '#!/bin/sh\necho "$1" >> "$FAKE_DIR/sleeps"\n[ "$1" = 30 ] && exit 0\nexec /bin/sleep "$@"\n' > "$case_dir/bin/sleep"
chmod +x "$case_dir/bin/sleep"
echo hang > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch
it 'without TAGTEAM_STALL the launcher waits 30 seconds'
if grep -qx 30 "$case_dir/fake/sleeps" && [ -s "$case_dir/fake/signals" ]; then pass; else fail; fi

setup stubborn
echo stubborn > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch TAGTEAM_STALL=1
it 'claude that ignores SIGTERM gets SIGKILL 10s later and the relaunch follows'
if grep -q term "$case_dir/fake/signals" && ! grep -q survived "$case_dir/fake/signals" &&
  [ "$(elapsed)" -ge 11 ] && [ "$(elapsed)" -le 14 ] && [ "$(field 2 cfg)" = "$case_dir/B" ]; then pass; else fail; fi

setup no-target
echo switch > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=\nresume_at=\nhandover=go\n' > "$case_dir/fake/switch"
launch; code=$?
it 'a switch with no target dir stops with an error instead of relaunching'
if [ "$code" != 0 ] && runs 1 && grep -q 'tagteam:' "$case_dir/out" && no_leftovers; then pass; else fail; fi

setup resume-at
echo switch > "$case_dir/fake/mode-1"
resume_at=$(($(date +%s) + 2))
printf 'session=s1\ntarget_dir=%s\nresume_at=%s\nhandover=go\n' "$case_dir/B" "$resume_at" > "$case_dir/fake/switch"
launch
it 'relaunch waits for resume_at'
if runs 2 && [ "$(field 2 t)" -ge "$resume_at" ]; then pass; else fail; fi

setup empty-active-dir
: > "$case_dir/home/state/active-dir"
launch
it 'empty active-dir leaves CLAUDE_CONFIG_DIR unset'
if [ "$(field 1 cfg)" = UNSET ]; then pass; else fail; fi

setup no-active-dir
launch
it 'missing active-dir leaves CLAUDE_CONFIG_DIR unset'
if [ "$(field 1 cfg)" = UNSET ]; then pass; else fail; fi

setup header
it 'keeps the header line the plugin uses to recognise an installed launcher'
if sed -n 2p bin/tagteam | grep -q '^# Runs claude on the active tagteam account'; then pass; else fail; fi

# remove reads its y/N from /dev/tty; TAGTEAM_CONFIRM answers instead, for these tests only.
# record <label> <dir> <email> <order> <excluded>, in the plugin's JSON layout
record() {
  mkdir -p "$case_dir/home/state/accounts"
  printf '{\n  "label": "%s",\n  "dir": "%s",\n  "accountUuid": "u-%s",\n  "email": "%s",\n  "order": %s,\n  "excluded": %s,\n  "needsSignIn": false\n}\n' \
    "$1" "$2" "$1" "$3" "$4" "$5" > "$case_dir/home/state/accounts/$1.json"
}
out_has() { grep -qF -- "$1" "$case_dir/out"; }
authed() { grep -qxF -- "$1" "$case_dir/fake/auth" 2>/dev/null; }

setup add
launch_args='add work'
launch; code=$?
it 'add signs the new folder in and leaves the record to the plugin'
if [ "$code" = 0 ] && authed "login $case_dir/home/work" && [ -f "$case_dir/home/work/.claude.json" ] &&
  [ ! -e "$case_dir/home/state/accounts/work.json" ] && runs 0 &&
  out_has "Added work (a@example.com). It's ready the next time you start tagteam." && out_has 'open the URL on another device'; then pass; else fail; fi

setup add-dup-email
record main "$case_dir/home/main" a@example.com 0 false
launch_args='add work'
launch; code=$?
it 'add of a login that is already an account signs the new folder out and deletes it'
if [ "$code" != 0 ] && [ ! -e "$case_dir/home/work" ] && authed "logout $case_dir/home/work" &&
  out_has 'Nothing added: that login is already main'; then pass; else fail; fi

setup add-bad-label
launch_args='add Work'
launch; code=$?
it 'add rejects a bad label without signing in'
if [ "$code" = 2 ] && [ ! -e "$case_dir/home/Work" ] && [ ! -e "$case_dir/fake/auth" ]; then pass; else fail; fi
launch_args='add state'
launch; code=$?
it 'add rejects the reserved label state'
if [ "$code" = 2 ] && [ ! -e "$case_dir/fake/auth" ]; then pass; else fail; fi

setup add-existing
mkdir -p "$case_dir/home/work"
record job "$case_dir/home/job" j@example.com 0 false
launch_args='add work'
launch; c1=$?
launch_args='add job'
launch; c2=$?
it 'add refuses an existing folder or record'
if [ "$c1" != 0 ] && [ "$c2" != 0 ] && out_has 'already exists' && [ ! -e "$case_dir/fake/auth" ]; then pass; else fail; fi

setup add-fails
echo fail > "$case_dir/fake/login"
launch_args='add work'
launch; code=$?
it 'a failed sign-in signs out and removes the new folder'
if [ "$code" != 0 ] && [ ! -e "$case_dir/home/work" ] && authed "logout $case_dir/home/work" && out_has 'not added'; then pass; else fail; fi

setup remove-active
mkdir -p "$case_dir/home/work"
record work "$case_dir/home/work" w@example.com 0 false
echo work > "$case_dir/home/state/active"
launch_args='remove work'
launch TAGTEAM_CONFIRM=y; code=$?
it 'remove refuses the active account'
if [ "$code" != 0 ] && [ -d "$case_dir/home/work" ] && [ ! -e "$case_dir/fake/auth" ] && out_has 'active account'; then pass; else fail; fi

setup remove-outside
mkdir -p "$case_dir/outside" "$case_dir/home/state/x" "$case_dir/home/a/b"
record x "$case_dir/outside" x@example.com 0 false
record y "$case_dir/home/state/x" y@example.com 1 false
record z "$case_dir/home/a/../../outside" z@example.com 2 false
record r1 "$case_dir/home//" r1@example.com 3 false
record r2 "$case_dir/home//state" r2@example.com 4 false
record r3 "$case_dir/home/a/b" r3@example.com 5 false
record r4 "$case_dir/home/../outside" r4@example.com 6 false
refused=0
for l in x y z r1 r2 r3 r4; do
  launch_args="remove $l"
  launch TAGTEAM_CONFIRM=y && continue
  grep -q refusing "$case_dir/out" && refused=$((refused + 1))
done
it 'remove refuses anything but one account folder right under the root'
if [ "$refused" = 7 ] && [ -d "$case_dir/outside" ] && [ -d "$case_dir/home/state/x" ] && [ -d "$case_dir/home/a/b" ] &&
  [ -f "$case_dir/home/state/accounts/x.json" ] && [ ! -e "$case_dir/fake/auth" ]; then pass; else fail; fi

setup remove-no
mkdir -p "$case_dir/home/work"
record work "$case_dir/home/work" w@example.com 0 false
launch_args='remove work'
launch TAGTEAM_CONFIRM=n; code=$?
it 'remove answered n keeps everything'
if [ "$code" != 0 ] && [ -d "$case_dir/home/work" ] && [ -f "$case_dir/home/state/accounts/work.json" ] &&
  [ ! -e "$case_dir/fake/auth" ] && out_has 'Remove work (w@example.com)? [y/N]'; then pass; else fail; fi

setup remove-yes
mkdir -p "$case_dir/home/work"
record work "$case_dir/home/work" w@example.com 0 false
launch_args='remove work'
launch TAGTEAM_CONFIRM=y; code=$?
it 'remove answered y signs out, deletes the folder and the record'
if [ "$code" = 0 ] && authed "logout $case_dir/home/work" && [ ! -e "$case_dir/home/work" ] &&
  [ ! -e "$case_dir/home/state/accounts/work.json" ] && out_has 'Removed work.'; then pass; else fail; fi

setup list
record zed "$case_dir/home/zed" z@example.com 0 true
record alpha "$case_dir/home/alpha" a@example.com 1 false
record beta "$case_dir/home/beta" b@example.com 1 false
echo alpha > "$case_dir/home/state/active"
launch_args=list
launch; code=$?
it 'list shows accounts in order with the active one marked'
if [ "$code" = 0 ] && printf '%s\n' '  zed  z@example.com (excluded)' '* alpha  a@example.com' '  beta  b@example.com' \
  'Usage and reset times: /tagteam status inside Claude.' | cmp -s - "$case_dir/out" && runs 0; then pass; else fail; fi

setup list-empty
launch_args=list
launch
it 'list with no accounts says how to add one'
if out_has 'tagteam add <label>'; then pass; else fail; fi

setup dashdash-add
launch_args='-- add'
launch
it '-- add passes add to claude'
if runs 1 && args_are 1 add; then pass; else fail; fi

setup prompt-word
launch_args='help me'
launch
it 'other first words still pass through'
if runs 1 && args_are 1 help me; then pass; else fail; fi
launch_args=

[ "$fails" = 0 ] && echo 'all passed' && exit 0
echo "$fails failed"
exit 1
