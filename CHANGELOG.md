# Changelog

## [0.3.1](https://github.com/jpo-oss/tagteam/compare/v0.3.0...v0.3.1) (2026-10-20)


### Bug Fixes

* say when a full account resets instead of limited ([#17](https://github.com/jpo-oss/tagteam/issues/17)) ([12b388e](https://github.com/jpo-oss/tagteam/commit/12b388e20166e843005e2ffee618ec692534d4ca))

## [0.3.0](https://github.com/jpo-oss/tagteam/compare/v0.2.0...v0.3.0) (2026-10-20)


### Features

* refresh account usage and show which account this session uses ([#15](https://github.com/jpo-oss/tagteam/issues/15)) ([6d8bf9f](https://github.com/jpo-oss/tagteam/commit/6d8bf9f4eee15e7b2775c38c28adfc5974bdc689))

## [0.2.0](https://github.com/jpo-oss/tagteam/compare/v0.1.0...v0.2.0) (2026-10-20)


### Features

* manage accounts from the terminal ([#12](https://github.com/jpo-oss/tagteam/issues/12)) ([ae980f7](https://github.com/jpo-oss/tagteam/commit/ae980f7caf3df1ec6f05c8d27fd6ff8c39057ed3))
* show accounts as cards with usage bars and readable dates ([#13](https://github.com/jpo-oss/tagteam/issues/13)) ([fb4a70a](https://github.com/jpo-oss/tagteam/commit/fb4a70a4f535dc85ab2e4d28be5bb78a9e945e01))
* tell users when a new version is out ([#10](https://github.com/jpo-oss/tagteam/issues/10)) ([f48e68d](https://github.com/jpo-oss/tagteam/commit/f48e68d1d05e559f0489ed2205a83f9c44727544))


### Bug Fixes

* drop session flags when relaunching after a switch ([#8](https://github.com/jpo-oss/tagteam/issues/8)) ([051d147](https://github.com/jpo-oss/tagteam/commit/051d147888c17b7f0cc712e9e22d16b3342a677e))

## 0.1.0 (2026-10-20)


### Features

* accounts dashboard ([b17812d](https://github.com/jpo-oss/tagteam/commit/b17812d3047861386a6334f657c9c994cb0471ff))
* add, edit and remove accounts ([d006f3f](https://github.com/jpo-oss/tagteam/commit/d006f3f24e52747945dbdd95ca98c9eea118b6f7))
* choose the freshest account ([fa09600](https://github.com/jpo-oss/tagteam/commit/fa09600facfaa6f437a011dfaa7150c8353797d7))
* launcher that restarts sessions on the active account ([400e317](https://github.com/jpo-oss/tagteam/commit/400e31728a0836e1649eca731d84d0932d39f006))
* record usage and tokens per account ([dcdf55c](https://github.com/jpo-oss/tagteam/commit/dcdf55cb9d94b60dc162a2b9210ce2cd649666c7))
* seed account app state without login data ([0d9a917](https://github.com/jpo-oss/tagteam/commit/0d9a917126c2a36b3cacc3e7bc88326ee0a124fc))
* shared state store ([cfd7982](https://github.com/jpo-oss/tagteam/commit/cfd7982eac8f3ae97b0d831413e7229af1294732))
* show the switch settings in the dashboard ([#4](https://github.com/jpo-oss/tagteam/issues/4)) ([98e21c5](https://github.com/jpo-oss/tagteam/commit/98e21c58589b709d25ccd20fb1122cbee49c15e3))
* switch accounts at the threshold ([770ffca](https://github.com/jpo-oss/tagteam/commit/770ffca52be2c9aef325e641c0c5e1fc9eb87a2a))
* track usage windows and early resets ([b83f779](https://github.com/jpo-oss/tagteam/commit/b83f779034e4236c6722ba35793d1c7eaffe331e))


### Bug Fixes

* clamp every dashboard line to the pane width ([a7fed71](https://github.com/jpo-oss/tagteam/commit/a7fed7141c60f7b258a23332af2cb86fa0f5ba58))
* copy folder trust even when the target account is in use ([81bf7ab](https://github.com/jpo-oss/tagteam/commit/81bf7abb5b169ad592ac6e84208dbd0ec2087d22))
* drop the dot separator ([2fd8488](https://github.com/jpo-oss/tagteam/commit/2fd8488d775af29a6989701ee6e002495de76bc7))
* guard and type the dashboard ([eacde3d](https://github.com/jpo-oss/tagteam/commit/eacde3d4340b92b7f5be8448705de7906191c82d))
* guard concurrent switch commits ([58ff9df](https://github.com/jpo-oss/tagteam/commit/58ff9dff42c3db8d6fc34c3be5bf7ca1d8f20d51))
* harden account removal and renames ([e638fe4](https://github.com/jpo-oss/tagteam/commit/e638fe4cab46c75c2166957b0505335e7e3c159e))
* ignore unparseable reset times ([7c06e34](https://github.com/jpo-oss/tagteam/commit/7c06e34986229f9a39e725b8e2f514d770157674))
* keep switching working after /clear ([39426a9](https://github.com/jpo-oss/tagteam/commit/39426a92ad79c068afbb6d5be2b780369df10f57))
* keep the launcher run id from leaking into nested claude runs ([1dbcd4c](https://github.com/jpo-oss/tagteam/commit/1dbcd4c79127b7f1c814bb6c7fc66775f787249e))
* keep the run id across plugin reloads ([2fa2585](https://github.com/jpo-oss/tagteam/commit/2fa25853ec3d1938231f53f0995ea1f7e7924bd0))
* name-check and escalate the launcher's stop ([3b50792](https://github.com/jpo-oss/tagteam/commit/3b507923867c3872cc5024dba5b4a4c5398b67da))
* never let tracking break a session ([b4566a5](https://github.com/jpo-oss/tagteam/commit/b4566a56113bd66ee18b254e557e9f6f2a536ad7))
* only refresh ~/.local/bin/tagteam when it is the tagteam launcher ([5945303](https://github.com/jpo-oss/tagteam/commit/5945303af9c057bc55836facd87660d58a8ad112))
* only start fresh when the resume itself failed ([f3adca7](https://github.com/jpo-oss/tagteam/commit/f3adca70c6999454368b4a02545fe671cd97c5e2))
* re-run helpers' waits after a switch without asking ([e37a2af](https://github.com/jpo-oss/tagteam/commit/e37a2af4a1169b01cc2a2d6a7dc40f15973cce91))
* refresh the status line after add, edit and remove ([89a53cd](https://github.com/jpo-oss/tagteam/commit/89a53cdd1d040f2d0e58ae9ca0e6fdb1d6b61999))
* rename accounts without moving their folders ([03ce9d0](https://github.com/jpo-oss/tagteam/commit/03ce9d091988ed012dc61609e1f06c9f2ea14fc7))
* scope decisions to a limit window and close the reclaim race ([3b19450](https://github.com/jpo-oss/tagteam/commit/3b194507456f64fe4355fb06f0f439c6beef0211))
* start fresh when a switched session has no conversation ([c8173e4](https://github.com/jpo-oss/tagteam/commit/c8173e4f1be59fa95f9f3acdd0338dbf03aaa802))
* tighten app state copying and trust inheritance ([96f4a45](https://github.com/jpo-oss/tagteam/commit/96f4a4526cab36191309de310b549b6034bd87ae))
* type errors found by tsc ([7e2507d](https://github.com/jpo-oss/tagteam/commit/7e2507d9afbcedbae6a93ce88e78ab53f9c0a3ed))
* wait on the soonest reset including the current account ([9bd69c7](https://github.com/jpo-oss/tagteam/commit/9bd69c75a7e647c602c8acc6fbcb7b9181044b70))
* write switches at turn end and tighten coordination ([0e390f7](https://github.com/jpo-oss/tagteam/commit/0e390f741f6f05a84a2538e52a277d7f90bb3ac7))
