import { appendFileSync } from "node:fs";
import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
const record = (value: unknown) =>
  appendFileSync(
    process.env.PINEVIM_FIXTURE_KEYS!,
    JSON.stringify(value) + "\n",
  );
class Probe extends CustomEditor {
  override handleInput(data: string): void {
    record({ hex: Buffer.from(data).toString("hex") });
    super.handleInput(data);
    record({ text: this.getText() });
  }
}
export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent(
      (tui, theme, keys) => new Probe(tui, theme, keys),
    );
  });
}
