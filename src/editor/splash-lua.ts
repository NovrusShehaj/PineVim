/**
 * PineVim startup splash Lua module (design E1).
 * Renders the transient pine motif + wordmark for ~800 ms after VimEnter.
 * Themed by the active PineVim palette (loaded by theme-script.ts before
 * arm() runs). Suppressed when `vim.o.lines < 16` or when the user has
 * opted out via `vim.g.pinevim_splash = false`.
 */
export const SPLASH_LUA = `local M = {}

local SPLASH_HEIGHT = 6
local SPLASH_DURATION_MS = 800

local SPLASH_LINES = {
  "        /\\\\",
  "       /||\\\\",
  "      /_/\\_\\\\",
  "        ||",
  "",
  "  pinevim -- a forest you can work in.",
}

local function get_palette()
  local accent = vim.g.pinevim_accent or "#7fd0a0"
  local muted = vim.g.pinevim_muted or "#7d887f"
  return { accent = accent, muted = muted }
end

function M.splash()
  if vim.g.pinevim_splash == false then return end
  if vim.o.lines < 16 then return end

  local palette = get_palette()
  local lines = {}
  for _, line in ipairs(SPLASH_LINES) do
    table.insert(lines, line)
  end

  local row = math.floor((vim.o.lines - SPLASH_HEIGHT) / 2) + 1
  local col = math.max(0, math.floor((vim.o.columns - 32) / 2))

  vim.api.nvim_set_hl(0, "PinevimSplashAccent", { fg = palette.accent, bold = true })
  vim.api.nvim_set_hl(0, "PinevimSplashMuted", { fg = palette.muted })

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  local win = vim.api.nvim_open_win(buf, false, {
    relative = "editor",
    width = 40,
    height = SPLASH_HEIGHT,
    row = row,
    col = col,
    style = "minimal",
    border = "none",
    focusable = false,
  })

  for i = 1, #lines do
    local ns = vim.api.nvim_create_namespace("pinevim_splash_" .. i)
    local hl = (i <= 4) and "PinevimSplashAccent" or "PinevimSplashMuted"
    vim.api.nvim_buf_add_highlight(buf, ns, hl, i - 1, 0, -1)
  end

  vim.defer_fn(function()
    if vim.api.nvim_win_is_valid(win) then
      pcall(vim.api.nvim_win_close, win, true)
    end
    if vim.api.nvim_buf_is_valid(buf) then
      pcall(vim.api.nvim_buf_delete, buf, { force = true })
    end
  end, SPLASH_DURATION_MS)
end

return M
`;
