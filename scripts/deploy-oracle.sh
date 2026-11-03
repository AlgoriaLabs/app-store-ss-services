#!/bin/sh
# npm run deploy: deploys this project to Oracle Cloud with infra/terraform, passing the service's settings from .env.
#
# infra/terraform/terraform.tfvars holds the Oracle account settings (see terraform.tfvars.example). Extra arguments
# go to `terraform apply`, such as -auto-approve. Works with Terraform or OpenTofu.
set -eu
cd "$(dirname "$0")/.."

if command -v terraform >/dev/null 2>&1; then TF=terraform
elif command -v tofu >/dev/null 2>&1; then TF=tofu
else echo "Install Terraform (https://developer.hashicorp.com/terraform/install) or OpenTofu first." >&2; exit 1; fi

[ -f infra/terraform/terraform.tfvars ] || { echo "Copy infra/terraform/terraform.tfvars.example to terraform.tfvars and fill it in." >&2; exit 1; }

# Read .env without running it as a script: KEY=VALUE lines only.
value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 | sed 's/^"\(.*\)"$/\1/' || true; }

export TF_VAR_pay_to="$(value PAY_TO)"
export TF_VAR_agent_id="$(value AGENT_ID)"
for pair in stellar_network:STELLAR_NETWORK facilitator_auth:FACILITATOR_AUTH soroban_rpc_url:SOROBAN_RPC_URL \
  price_usdc:PRICE_USDC llm_base_url:LLM_BASE_URL llm_api_key:LLM_API_KEY llm_model:LLM_MODEL llm_fallback_model:LLM_FALLBACK_MODEL \
  llm_reasoning_effort:LLM_REASONING_EFFORT llm_vision:LLM_VISION \
  github_token:GITHUB_TOKEN render_concurrency:RENDER_CONCURRENCY retention_seconds:RETENTION_SECONDS; do
  var="${pair%%:*}"; key="${pair#*:}"; v="$(value "$key")"
  [ -n "$v" ] && export "TF_VAR_$var=$v"
done

if [ "$(value STELLAR_NETWORK)" = "stellar:pubnet" ] && [ -n "$TF_VAR_pay_to" ] && [ -z "$(value FACILITATOR_AUTH)" ]; then
  echo "FACILITATOR_AUTH is empty in .env: mainnet payments need an API key from https://channels.openzeppelin.com/gen" >&2; exit 1
fi

$TF -chdir=infra/terraform init -input=false -upgrade >/dev/null
$TF -chdir=infra/terraform apply "$@"
echo
echo "Public address: $($TF -chdir=infra/terraform output -raw public_origin)"
[ -n "$TF_VAR_pay_to" ] || echo "Next: npm run launch -- --url $($TF -chdir=infra/terraform output -raw public_origin)   then npm run deploy again."
