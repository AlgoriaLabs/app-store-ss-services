# Oracle Cloud account. With the OCI CLI set up (`oci setup config`), the provider reads the API key from
# ~/.oci/config; only the tenancy and compartment OCIDs are needed here.
variable "tenancy_ocid" {
  description = "Your tenancy's OCID (Profile > Tenancy in the console)."
  type        = string
}

variable "compartment_ocid" {
  description = "Where to create everything. The tenancy OCID itself is the root compartment."
  type        = string
}

variable "region" {
  description = "Your home region, such as eu-frankfurt-1: Always Free A1 capacity is only in the home region."
  type        = string
}

variable "oci_config_profile" {
  description = "Profile in ~/.oci/config."
  type        = string
  default     = "DEFAULT"
}

variable "name" {
  type    = string
  default = "app-store-ss"
}

variable "shape" {
  description = "VM.Standard.A1.Flex (Ampere, arm64, Always Free up to 4 OCPU / 24 GB) or VM.Standard.E2.1.Micro (1 GB: too small for Chromium)."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  type    = number
  default = 2
}

variable "memory_gbs" {
  type    = number
  default = 12
}

variable "boot_volume_gbs" {
  description = "Always Free includes 200 GB of block volume in total."
  type        = number
  default     = 50
}

variable "availability_domain_index" {
  description = "Try 1 or 2 if A1 says 'Out of host capacity' in the first one."
  type        = number
  default     = 0
}

variable "image_ocid" {
  description = "Leave empty for the newest Ubuntu 24.04 image for the shape."
  type        = string
  default     = ""
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_private_key_path" {
  description = "Used by Terraform to copy the source and start the containers."
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_allowed_cidr" {
  description = "Who may SSH in. Your own IP as x.x.x.x/32 is safer."
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain" {
  description = "Your domain, with an A record to the server's IP. Empty: <ip>.sslip.io, which needs no DNS setup."
  type        = string
  default     = ""
}

# The service's settings, as in .env. `npm run deploy` passes them from .env.
variable "pay_to" {
  description = "The public G... address clients pay. Empty until `npm run launch` sets it up in your wallet."
  type        = string
  default     = ""
}

variable "agent_id" {
  type    = string
  default = ""
}

variable "stellar_network" {
  type    = string
  default = "stellar:pubnet"
  validation {
    condition     = contains(["stellar:pubnet", "stellar:testnet"], var.stellar_network)
    error_message = "stellar_network is stellar:pubnet (mainnet) or stellar:testnet."
  }
}

variable "facilitator_auth" {
  description = "Mainnet facilitator API key, as \"Bearer <key>\" (https://channels.openzeppelin.com/gen)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "soroban_rpc_url" {
  type    = string
  default = "https://mainnet.sorobanrpc.com"
}

variable "price_usdc" {
  type    = string
  default = "0.25"
}

variable "llm_base_url" {
  type    = string
  default = "https://generativelanguage.googleapis.com/v1beta/openai"
}

variable "llm_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "llm_model" {
  type    = string
  default = "gemini-3.1-flash-lite"
}

variable "llm_fallback_model" {
  type    = string
  default = "gemini-3.5-flash-lite"
}

variable "llm_reasoning_effort" {
  type    = string
  default = "low"
}

variable "llm_vision" {
  type    = string
  default = "true"
}

variable "github_token" {
  type      = string
  default   = ""
  sensitive = true
}

variable "render_concurrency" {
  type    = number
  default = 2
}

variable "retention_seconds" {
  type    = number
  default = 604800
}
