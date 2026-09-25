/**
 * PineVim wordmark + tabline/empty-buffer Lua module (design E2).
 *
 * Provides minimal brand markers when bufferline / lualine are NOT
 * installed. When the user's plugins ARE installed, this module
 * stays dormant and the user's plugins own the chrome.
 *
 * Honored user opt-outs:
 *   vim.g.pinevim_chrome = false  -- skip all chrome
 *   vim.g.pinevim_wordmark = "..." -- override the brand text
 */

export const WORDMARK_LUA = `local M = {}

-- Default brand text. The user can override via vim.g.pinevim_wordmark.
local DEFAULT_WORDMARK = "pinevim"

function M.wordmark()
  if vim.g.pinevim_chrome == false then return "" end
  return vim.g.pinevim_wordmark or DEFAULT_WORDMARK
end

-- Minimal tabline rendered when bufferline is not installed. Activates
-- automatically if the user has no 'tabline' set. The PineVim brand
-- sits on the left; buffer names sit center; modified indicator on
-- the right.
function M.tabline()
  if vim.g.pinevim_chrome == false then return "" end
  if vim.fn.exists("*bufferline#refresh") == 1 then return "" end
  if vim.fn.exists("*BufferLineRefresh") == 1 then return "" end

  local brand = M.wordmark()
  local modified = vim.bo.modified and " +" or ""
  local ft = vim.bo.filetype
  local bufname = vim.fn.bufname()

  local left = "%#PinevimTablineBrand#" .. brand .. " "
  local center = "%#PinevimTablineBuf# " .. bufname .. " "
  local right = "%#PinevimTablineMeta#" .. (ft ~= "" and ft or "no ft") .. modified .. " "

  return table.concat({ left, center, right, "%#PinevimTablineFill#" })
end

-- Empty-buffer brand header. Renders once when the buffer is empty and
-- unfocused-history is empty. Helps first-time users recognize they are
-- in a PineVim session.
function M.empty_header()
  if vim.g.pinevim_chrome == false then return "" end
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  if #lines > 0 then return "" end
  if vim.bo.buftype ~= "" then return "" end
  return "▲ pinevim -- buffer unsaved. type to begin."
end

return M
`;
