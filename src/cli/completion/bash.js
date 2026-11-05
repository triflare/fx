/** Generate a bash completion script. */
export function bashCompletion(command) {
  return `# bash completion for ${command}
_${command}_complete() {
  local IFS=$'\\n'
  COMPREPLY=( $("${command}" __complete bash -- "\${COMP_WORDS[@]:1}") )
}
complete -o bashdefault -o default -F _${command}_complete ${command}
`;
}
