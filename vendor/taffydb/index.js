// taffydb is unmaintained and affected by CVE-2019-10790 (index forgery).
// scratch-vm declares it but never requires it, so it is overridden with this
// stub rather than installing the vulnerable package. If a dependency starts
// using taffydb, this throws so the override can be revisited.
throw new Error(
  "taffydb is not installed: it is unmaintained and affected by " +
    "CVE-2019-10790. Replace this override only if a dependency actually " +
    "needs it.",
);
