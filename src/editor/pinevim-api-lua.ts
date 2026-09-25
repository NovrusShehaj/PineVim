/**
 * PineVim public Lua API (design E2).
 *
 * The user's Neovim config can call any of these after the bundled
 * theme-script arms the PinevimTheme autocmd group. All entry points
 * are idempotent and safe to call multiple times.
 */

export const PINEVIM_API_LUA = `local M = {}

--- Apply chrome (splash + themed statusline + accent highlights).
function M.setup()
  if vim.g.pinevim_chrome == false then return end
  pcall(function() require("pinevim.splash").splash() end)
  vim.cmd([[
    set statusline^=%{&modified?'\\ %*\\ ':'\\ \\ \\ '}
    set statusline+=%#PinevimStatusBrand#\\ %{get(g:,'pinevim_wordmark','pinevim')}\\ \\
    set statusline+=%#StatusLine#\\ %f\\ \\
    set statusline+=%#PinevimStatusMuted#\\ %{get(g:,'pinevim_agent_lifecycle','offline')}\\ \\ \\
    set statusline+=%#StatusLineNC#\\ %l:%c\\ \\ \\
  ]])
end

--- Render the transient startup splash on demand.
function M.splash()
  pcall(function() require("pinevim.splash").splash() end)
end

--- Themed statusline expression for users who want to embed it in
--- their own lualine / bufferline config.
function M.statusline()
  return [[ %{&modified?' \\u25cf ':'   '} %{get(g:,'pinevim_wordmark','pinevim')} %f %{get(g:,'pinevim_agent_lifecycle','offline')} %l:%c  ]]
end

--- Resolved trunk factor for the active theme (E6).
function M.trunk_factor()
  return vim.g.pinevim_trunk_factor or 0.6
end

--- Re-apply highlights from the current theme.
function M.apply_palette()
  -- theme-script.ts already wired the User PinevimReady autocmd;
  -- this is a no-op stub for user convenience.
end

--- Wordmark text (overridable via vim.g.pinevim_wordmark).
function M.wordmark()
  return vim.g.pinevim_wordmark or "pinevim"
end

return M
`;
