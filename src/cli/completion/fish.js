/** Generate a fish completion script. */
export function fishCompletion(command) {
  return `# fish completion for ${command}
function __${command}_complete
  ${command} __complete fish -- (commandline -opc)[2..-1]
end
complete -c ${command} -f -a '(__${command}_complete)'
`;
}
