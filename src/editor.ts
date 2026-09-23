import { executable } from "./config.js";
export async function editorCommand(path: string): Promise<string[]> {
  // Unset remote-editor markers only for this child, preserving intentional NVIM_APPNAME.
  return [
    "/usr/bin/env",
    "-u",
    "NVIM",
    "-u",
    "NVIM_LISTEN_ADDRESS",
    await executable(path),
  ];
}
