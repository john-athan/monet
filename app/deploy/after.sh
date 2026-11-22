#!/usr/bin/env bash
# Monet's helper commands, written by the template's install.sh before the restart. HOST_NAME comes from app.env.
set -euo pipefail
# recovery: monet-reset-passkeys [name] prints a one-time link (one hour) that replaces that person's passkeys. Runs as the service user, so the database stays its own.
cat > /usr/local/bin/monet-reset-passkeys <<WRAP
#!/usr/bin/env bash
[ \$EUID -eq 0 ] || { echo "run as root" >&2; exit 1; }
exec runuser -u monet -- env MONET_ORIGIN=https://$HOST_NAME MONET_DB=/var/lib/monet/monet.db MONET_DATA=/var/lib/monet/data \
  MONET_ORIGINALS=/var/lib/monet/originals /usr/local/lib/monet/monet reset-passkeys "\$@"
WRAP
chmod 755 /usr/local/bin/monet-reset-passkeys
# the accounts module's other commands (docs/accounts.md), same wrapper:
#   monet-invite <name> [--admin] [--theme monet|ernst|magritte]   a new person and the link for their first passkey
#   monet-members                                                   who is here, their role, and open links
sed "s/ reset-passkeys / invite /" /usr/local/bin/monet-reset-passkeys > /usr/local/bin/monet-invite && chmod 755 /usr/local/bin/monet-invite
sed "s/ reset-passkeys / members /" /usr/local/bin/monet-reset-passkeys > /usr/local/bin/monet-members && chmod 755 /usr/local/bin/monet-members
