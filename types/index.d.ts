export type TagteamRun = string

declare module 'claude-code' {
  interface PluginState {
    tagteam: { run: TagteamRun }
  }
}
