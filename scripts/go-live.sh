#!/bin/sh
# npm run go-live: everything from a fresh clone to a live, registered mainnet service on Oracle Cloud, in one run.
#
#   npm run go-live                 (asks for the keys, hidden)
#   GEMINI_API_KEY=... OZ_API_KEY=... npm run go-live
#
# It fills in .env and infra/terraform/terraform.tfvars by itself (Oracle settings from your OCI CLI's ~/.oci/config),
# makes an SSH key for the server if you have none, creates the server, then opens your wallet once to register the
# service, and starts it. It asks only for what it can't find: the Gemini key (if not in GEMINI_API_KEY), the
# OpenZeppelin facilitator key (it opens the page that gives one), and your wallet's approval. Safe to run again.
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
TFDIR=infra/terraform
TFVARS=$TFDIR/terraform.tfvars
PROFILE="${OCI_CLI_PROFILE:-DEFAULT}"
OCI_CONFIG="${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
open_url() { (command -v open >/dev/null && open "$1") || (command -v xdg-open >/dev/null && xdg-open "$1") || true; }

# Reads KEY from .env; sets it (replacing the line) with setenv KEY VALUE.
getenv() { sed -n "s/^$1=//p" .env | tail -n 1 | sed 's/^"\(.*\)"$/\1/'; }
setenv() {
  tmp=$(mktemp)
  if grep -q "^$1=" .env; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > "$tmp"
  else
    cat .env > "$tmp"; printf '%s=%s\n' "$1" "$2" >> "$tmp"
  fi
  mv "$tmp" .env && chmod 600 .env
}
ociconf() {
  awk -v p="[$PROFILE]" -v k="$1" '$0==p{f=1;next} /^\[/{f=0} f{split($0,a,"="); gsub(/[ \t]/,"",a[1]); if(a[1]==k){sub(/^[^=]*=[ \t]*/,""); print; exit}}' "$OCI_CONFIG"
}

say "1/7 Tools"
command -v node >/dev/null || die "Install Node.js 22.13 or later: https://nodejs.org"
if ! command -v terraform >/dev/null && ! command -v tofu >/dev/null; then
  if command -v brew >/dev/null; then
    printf 'Terraform is missing. Install it with Homebrew now? [Y/n] '; read -r answer
    case "$answer" in [nN]*) die "Install Terraform: https://developer.hashicorp.com/terraform/install";; esac
    brew tap hashicorp/tap && brew install hashicorp/tap/terraform
  else
    die "Install Terraform: https://developer.hashicorp.com/terraform/install"
  fi
fi
[ -f "$OCI_CONFIG" ] || die "No $OCI_CONFIG: install the OCI CLI and run 'oci setup config' first (https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm)."
[ -d node_modules ] || npm install --no-fund --no-audit

say "2/7 Settings (.env)"
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Made .env from .env.example"; }
setenv STELLAR_NETWORK stellar:pubnet
if [ -z "$(getenv LLM_API_KEY)" ]; then
  key="${GEMINI_API_KEY:-}"
  if [ -z "$key" ]; then printf 'Gemini API key (https://aistudio.google.com/apikey, Enter to skip): '; stty -echo 2>/dev/null || true; read -r key; stty echo 2>/dev/null || true; echo; fi
  [ -n "$key" ] && setenv LLM_API_KEY "$key"
fi
if [ -n "$(getenv LLM_API_KEY)" ]; then
  model="$(getenv LLM_MODEL)"; model="${model:-gemini-3.1-flash-lite}"
  code=$(curl -s -o /tmp/gemini-check.json -w '%{http_code}' -m 30 "$(getenv LLM_BASE_URL)/chat/completions" \
    -H "Authorization: Bearer $(getenv LLM_API_KEY)" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}],\"max_tokens\":5}" || echo 000)
  if [ "$code" = 200 ]; then echo "✓ Gemini key works with $model"
  else echo "! Gemini answered $code for $model: $(head -c 300 /tmp/gemini-check.json 2>/dev/null). Headlines will come from READMEs until it works."; fi
fi
if [ -z "$(getenv FACILITATOR_AUTH)" ] && [ -n "${OZ_API_KEY:-}" ]; then setenv FACILITATOR_AUTH "\"Bearer $OZ_API_KEY\""; fi
if [ -z "$(getenv FACILITATOR_AUTH)" ]; then
  echo "Mainnet payments settle through OpenZeppelin's facilitator, which needs a free API key."
  echo "Opening https://channels.openzeppelin.com/gen — make a key there and paste it here."
  open_url https://channels.openzeppelin.com/gen
  printf 'OpenZeppelin API key: '; stty -echo 2>/dev/null || true; read -r ozkey; stty echo 2>/dev/null || true; echo
  [ -n "$ozkey" ] || die "The facilitator key is needed for mainnet."
  case "$ozkey" in Bearer\ *) setenv FACILITATOR_AUTH "\"$ozkey\"";; *) setenv FACILITATOR_AUTH "\"Bearer $ozkey\"";; esac
fi

say "3/7 Oracle Cloud settings ($TFVARS, from $OCI_CONFIG [$PROFILE])"
TENANCY="$(ociconf tenancy)"; REGION="$(ociconf region)"
[ -n "$TENANCY" ] && [ -n "$REGION" ] || die "Couldn't read tenancy and region from $OCI_CONFIG [$PROFILE]."
KEY="${SSH_KEY:-$HOME/.ssh/app-store-ss}"
[ -f "$KEY" ] || { ssh-keygen -q -t ed25519 -N "" -C app-store-ss -f "$KEY"; echo "Made an SSH key for the server: $KEY"; }
if [ ! -f "$TFVARS" ]; then
  cat > "$TFVARS" <<EOF
# Written by scripts/go-live.sh from $OCI_CONFIG [$PROFILE]. Kept out of git.
tenancy_ocid         = "$TENANCY"
compartment_ocid     = "${COMPARTMENT_OCID:-$TENANCY}"
region               = "$REGION"
oci_config_profile   = "$PROFILE"
ssh_public_key_path  = "$KEY.pub"
ssh_private_key_path = "$KEY"
EOF
  echo "✓ Wrote $TFVARS (region $REGION)"
else
  echo "✓ $TFVARS exists: kept as it is"
fi

say "4/7 Server: VCN, Ampere A1 VM, Docker, Caddy (Terraform)"
sh scripts/deploy-oracle.sh -auto-approve || die "Terraform failed. 'Out of host capacity' is common for A1: add availability_domain_index = 1 (or 2) to $TFVARS and run npm run go-live again."
TF=terraform; command -v terraform >/dev/null || TF=tofu
ORIGIN="$($TF -chdir=$TFDIR output -raw public_origin)"
echo "Public address: $ORIGIN"

if [ -z "$(getenv PAY_TO)" ] || [ -z "$(getenv AGENT_ID)" ]; then
  say "5/7 Register on Stellar mainnet (your wallet approves)"
  echo "A page opens: connect your wallet (Freighter, xBull, Albedo, Hana or Ledger) with a few XLM, and approve the"
  echo "USDC trustline, the Stellar 8004 registration and the verification request. Nothing is signed without you."
  npm run launch -- --url "$ORIGIN"
  [ -n "$(getenv PAY_TO)" ] || die "PAY_TO wasn't saved: run npm run go-live again once the wallet approval is done."
else
  say "5/7 Already registered: PAY_TO $(getenv PAY_TO), agent $(getenv AGENT_ID)"
fi

say "6/7 Start the service"
sh scripts/deploy-oracle.sh -auto-approve

say "7/7 Check it"
MANIFEST="$ORIGIN/.well-known/stellar-agent-services.json"
printf 'Waiting for %s ' "$MANIFEST"
i=0; until curl -fsS -m 10 -o /dev/null "$MANIFEST" 2>/dev/null; do i=$((i+1)); [ $i -gt 60 ] && break; printf '.'; sleep 5; done; echo
npx provider-kit check --manifest "$MANIFEST" || true
npx provider-kit status --url "$ORIGIN" || true
say "Live: $ORIGIN"
echo "Manifest: $MANIFEST"
echo "Logs: ssh -i $KEY ubuntu@$($TF -chdir=$TFDIR output -raw public_ip) 'cd /opt/app/deploy && sudo docker compose logs -f app'"
