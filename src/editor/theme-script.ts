/**
 * Neovim highlight script applied only to the editor PineVIM launches.
 * It reads the same theme JSON as the Pi pane and does not edit user config.
 */
export const NVIM_THEME_LUA = `local M = {}

local function theme_name()
  local name = vim.env.PINEVIM_UI_THEME or "auto"
  if name == "auto" or name == "" then
    if vim.o.background == "light" then
      return "pinevim-light"
    end
    return "pinevim-dark"
  end
  if not name:match("^pinevim%-[a-z]+$") then
    return "pinevim-dark"
  end
  return name
end

local function hex_of(colors, vars, slot)
  local value = colors[slot]
  if type(value) ~= "string" then
    return nil
  end
  if value:sub(1, 1) == "#" then
    return value
  end
  local ref = vars[value]
  if type(ref) == "string" and ref:sub(1, 1) == "#" then
    return ref
  end
  return nil
end

local function load_palette(name)
  local dir = vim.env.PINEVIM_THEME_DIR
  if type(dir) ~= "string" or dir == "" or dir:find("%.%.", 1, true) then
    return nil
  end
  local path = dir .. "/" .. name .. ".json"
  local ok, lines = pcall(vim.fn.readfile, path)
  if not ok or type(lines) ~= "table" then
    if name ~= "pinevim-dark" then
      return load_palette("pinevim-dark")
    end
    return nil
  end
  local decoded = vim.fn.json_decode(lines)
  if type(decoded) ~= "table" then
    return nil
  end
  local colors = decoded.colors or {}
  local vars = decoded.vars or {}
  return {
    accent = hex_of(colors, vars, "accent"),
    text = hex_of(colors, vars, "text"),
    muted = hex_of(colors, vars, "muted"),
    dim = hex_of(colors, vars, "dim"),
    border = hex_of(colors, vars, "border"),
    error = hex_of(colors, vars, "error"),
    warning = hex_of(colors, vars, "warning"),
    success = hex_of(colors, vars, "success"),
    selected = hex_of(colors, vars, "selectedBg"),
    custom = hex_of(colors, vars, "customMessageBg"),
    keyword = hex_of(colors, vars, "syntaxKeyword"),
    fn = hex_of(colors, vars, "syntaxFunction"),
    str = hex_of(colors, vars, "syntaxString"),
    num = hex_of(colors, vars, "syntaxNumber"),
    type = hex_of(colors, vars, "syntaxType"),
    comment = hex_of(colors, vars, "syntaxComment"),
    variable = hex_of(colors, vars, "syntaxVariable"),
    operator = hex_of(colors, vars, "syntaxOperator"),
    link = hex_of(colors, vars, "mdLink"),
    heading = hex_of(colors, vars, "mdHeading"),
  }
end

local function hi(group, spec)
  local clean = {}
  for key, value in pairs(spec) do
    if value ~= nil then
      clean[key] = value
    end
  end
  if next(clean) ~= nil then
    vim.api.nvim_set_hl(0, group, clean)
  end
end

local function link(group, target)
  hi(group, { link = target })
end

function M.apply()
  if vim.env.PINEVIM ~= "1" then
    return
  end
  local palette = load_palette(theme_name())
  if not palette or not palette.text or not palette.accent then
    return
  end
  vim.g.colors_name = "pinevim"
  local none = "NONE"
  hi("Normal", { fg = palette.text, bg = none })
  hi("NormalNC", { fg = palette.text, bg = none })
  hi("NormalFloat", { fg = palette.text, bg = palette.custom or none })
  hi("FloatBorder", { fg = palette.border, bg = palette.custom or none })
  hi("FloatTitle", { fg = palette.heading or palette.accent, bg = palette.custom or none })
  hi("WinSeparator", { fg = palette.border, bg = none })
  hi("SignColumn", { fg = palette.dim, bg = none })
  hi("LineNr", { fg = palette.dim, bg = none })
  hi("CursorLine", { bg = palette.selected })
  hi("CursorLineNr", { fg = palette.accent, bg = palette.selected, bold = true })
  hi("Visual", { bg = palette.selected })
  hi("Search", { fg = palette.text, bg = palette.selected })
  hi("CurSearch", { fg = palette.selected, bg = palette.accent })
  hi("StatusLine", { fg = palette.text, bg = none })
  hi("StatusLineNC", { fg = palette.muted, bg = none })
  hi("TabLine", { fg = palette.muted, bg = none })
  hi("TabLineFill", { fg = palette.dim, bg = none })
  hi("TabLineSel", { fg = palette.accent, bg = none, bold = true })
  hi("WinBar", { fg = palette.muted, bg = none })
  hi("WinBarNC", { fg = palette.dim, bg = none })
  hi("Pmenu", { fg = palette.text, bg = palette.custom or none })
  hi("PmenuSel", { fg = palette.accent, bg = palette.selected, bold = true })
  hi("PmenuMatch", { fg = palette.accent, bg = palette.selected, bold = true })
  hi("PmenuExtra", { fg = palette.muted, bg = palette.custom or none })
  hi("PmenuKind", { fg = palette.teal, bg = palette.custom or none })
  hi("PmenuBorder", { fg = palette.border, bg = palette.custom or none })
  hi("Comment", { fg = palette.comment, italic = true })
  hi("Keyword", { fg = palette.keyword })
  hi("Statement", { fg = palette.keyword })
  hi("Conditional", { fg = palette.keyword })
  hi("Repeat", { fg = palette.keyword })
  hi("Function", { fg = palette.fn })
  hi("String", { fg = palette.str })
  hi("Number", { fg = palette.num })
  hi("Type", { fg = palette.type })
  hi("Identifier", { fg = palette.variable })
  hi("Operator", { fg = palette.operator })
  hi("Delimiter", { fg = palette.operator })
  hi("Special", { fg = palette.accent })
  hi("Title", { fg = palette.heading or palette.accent, bold = true })
  hi("Error", { fg = palette.error })
  hi("ErrorMsg", { fg = palette.error })
  hi("WarningMsg", { fg = palette.warning })
  hi("MoreMsg", { fg = palette.accent })
  hi("ModeMsg", { fg = palette.accent })
  hi("MsgArea", { fg = palette.muted })
  hi("MsgSeparator", { fg = palette.border })
  hi("EndOfBuffer", { fg = palette.dim })
  hi("NonText", { fg = palette.border })
  hi("Directory", { fg = palette.fn })
  hi("DiagnosticError", { fg = palette.error })
  hi("DiagnosticWarn", { fg = palette.warning })
  hi("DiagnosticInfo", { fg = palette.link })
  hi("DiagnosticHint", { fg = palette.fn })
  hi("DiagnosticOk", { fg = palette.success })
  hi("DiffAdd", { fg = palette.success })
  hi("DiffDelete", { fg = palette.error })
  hi("DiffChange", { fg = palette.warning })
  hi("Added", { fg = palette.success })
  hi("Removed", { fg = palette.error })
  hi("Changed", { fg = palette.warning })
  link("@comment", "Comment")
  link("@keyword", "Keyword")
  link("@function", "Function")
  link("@string", "String")
  link("@number", "Number")
  link("@type", "Type")
  link("@variable", "Identifier")
  link("@operator", "Operator")
  link("@markup.heading", "Title")
  link("@markup.link", "DiagnosticInfo")
  link("@diff.plus", "DiffAdd")
  link("@diff.minus", "DiffDelete")
  hi("BufferLineFill", { fg = palette.dim, bg = none })
  hi("BufferLineBackground", { fg = palette.muted, bg = none })
  hi("BufferLineBufferVisible", { fg = palette.text, bg = none })
  hi("BufferLineBufferSelected", { fg = palette.accent, bg = none, bold = true })
  hi("BufferLineSeparator", { fg = palette.border, bg = none })
  hi("BufferLineIndicatorSelected", { fg = palette.accent, bg = none })
  hi("BufferLineModifiedSelected", { fg = palette.warning, bg = none })
  vim.o.laststatus = 3
  local lualine_ok, lualine = pcall(require, "lualine")
  if lualine_ok and type(lualine.get_config) == "function" then
    local cfg = vim.deepcopy(lualine.get_config())
    cfg.options = cfg.options or {}
    cfg.options.theme = {
      normal = {
        a = { fg = palette.selected or palette.text, bg = palette.accent, gui = "bold" },
        b = { fg = palette.text, bg = palette.selected },
        c = { fg = palette.muted, bg = none },
      },
      insert = {
        a = { fg = palette.selected or palette.text, bg = palette.fn, gui = "bold" },
        b = { fg = palette.text, bg = palette.selected },
        c = { fg = palette.muted, bg = none },
      },
      visual = {
        a = { fg = palette.selected or palette.text, bg = palette.num, gui = "bold" },
        b = { fg = palette.text, bg = palette.selected },
        c = { fg = palette.muted, bg = none },
      },
      replace = {
        a = { fg = palette.text, bg = palette.error, gui = "bold" },
        b = { fg = palette.text, bg = palette.selected },
        c = { fg = palette.muted, bg = none },
      },
      command = {
        a = { fg = palette.selected or palette.text, bg = palette.warning, gui = "bold" },
        b = { fg = palette.text, bg = palette.selected },
        c = { fg = palette.muted, bg = none },
      },
      inactive = {
        a = { fg = palette.muted, bg = none },
        b = { fg = palette.muted, bg = none },
        c = { fg = palette.dim, bg = none },
      },
    }
    cfg.options.component_separators = { left = " ", right = " " }
    cfg.options.section_separators = { left = " ", right = " " }
    pcall(lualine.setup, cfg)
  end
end

function M.arm()
  if vim.env.PINEVIM ~= "1" then
    return
  end
  local group = vim.api.nvim_create_augroup("PinevimTheme", { clear = true })
  vim.api.nvim_create_autocmd("User", {
    group = group,
    pattern = "LazyDone",
    callback = function()
      M.apply()
    end,
  })
  vim.api.nvim_create_autocmd("VimEnter", {
    group = group,
    callback = function()
      vim.defer_fn(M.apply, 50)
    end,
  })
end

return M
`;
