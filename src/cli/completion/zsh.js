/** Generate a zsh completion script. */
export function zshCompletion(command) {
  return `#compdef ${command}
_${command}_complete() {
  local -a completions
  completions=("\${(@f)$("${command}" __complete zsh -- "\${words[@]:1}")}")
  _describe '${command}' completions
}
compdef _${command}_complete ${command}
`;
}
