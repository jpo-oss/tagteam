#!/bin/sh
# Launcher tests: sh test/launcher.test.sh (TEST_SH=dash runs the launcher under another shell)
cd "$(dirname "$0")/.." || exit 1
repo=$(pwd)
fails=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

setup() {
  case_dir="$tmp/$1"
  mkdir -p "$case_dir/bin" "$case_dir/home/state" "$case_dir/fake"
  ln -s "$repo/test/fake-claude" "$case_dir/bin/claude"
  : > "$case_dir/fake/log"
}

launch() {
  (
    unset CLAUDE_CONFIG_DIR
    env PATH="$case_dir/bin:$PATH" TAGTEAM_HOME="$case_dir/home" FAKE_DIR="$case_dir/fake" \
      "$@" "${TEST_SH:-sh}" "$repo/bin/tagteam" --model opus </dev/null >"$case_dir/out" 2>&1
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
printf 'session=s1\ntarget_label=b\ntarget_dir=%s\nresume_at=\nreason=limit\nhandover=%s\nstall=30\n' "$case_dir/B" "$handover" > "$case_dir/fake/switch"
launch; code=$?
it 'switch file consumed and second exit code returned'
if [ "$code" = 0 ] && runs 2 && no_leftovers; then pass; else fail; fi
it 'relaunches on target dir with resume and handover'
if [ "$(field 2 cfg)" = "$case_dir/B" ] && args_are 2 --resume s1 "$handover" --model opus; then pass; else fail; fi
it 'handover with quotes, globs and substitutions arrives as one unchanged argument'
if [ "$(sed -n 3p "$case_dir/fake/args-2")" = "$handover" ] && [ ! -e pwned ] && [ ! -e "$case_dir/pwned" ]; then pass; else fail; fi
it 'relaunch rewrites the run file'
if line 2 | grep -q "runfile=dir=$case_dir/B pid="; then pass; else fail; fi

setup no-conversation
echo switch > "$case_dir/fake/mode-1"
printf 'session=\ntarget_label=b\ntarget_dir=%s\nresume_at=\nhandover=go\nstall=30\n' "$case_dir/B" > "$case_dir/fake/switch"
launch; code=$?
it 'a switch with no conversation starts claude fresh on the target with the original args'
if [ "$code" = 0 ] && runs 2 && [ "$(field 2 cfg)" = "$case_dir/B" ] && args_are 2 --model opus && no_leftovers; then pass; else fail; fi

setup resume-fails
echo switch > "$case_dir/fake/mode-1"
echo 'exit 1' > "$case_dir/fake/mode-2"
printf 'session=s1\ntarget_label=b\ntarget_dir=%s\nresume_at=\nhandover=go\nstall=30\n' "$case_dir/B" > "$case_dir/fake/switch"
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

setup stall
echo "$case_dir/A" > "$case_dir/home/state/active-dir"
echo hang > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\n' "$case_dir/B" > "$case_dir/fake/switch"
launch TAGTEAM_STALL=1
it 'stalled claude gets SIGTERM within 3s and relaunch follows'
if [ -s "$case_dir/fake/signals" ] && [ "$(elapsed)" -le 3 ] && [ "$(field 2 cfg)" = "$case_dir/B" ]; then pass; else fail; fi

setup stall-from-file
echo hang > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\nstall=1\n' "$case_dir/B" > "$case_dir/fake/switch"
launch TAGTEAM_STALL=60
it 'stall in the switch file wins over TAGTEAM_STALL'
if [ -s "$case_dir/fake/signals" ] && [ "$(elapsed)" -le 3 ]; then pass; else fail; fi

setup stubborn
echo stubborn > "$case_dir/fake/mode-1"
printf 'session=s1\ntarget_dir=%s\nresume_at=\nhandover=go\nstall=1\n' "$case_dir/B" > "$case_dir/fake/switch"
launch
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

[ "$fails" = 0 ] && echo 'all passed' && exit 0
echo "$fails failed"
exit 1
