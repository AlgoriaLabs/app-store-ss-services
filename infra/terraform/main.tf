# App Store Screenshot Studio on Oracle Cloud's Always Free tier: one Ampere A1 VM (arm64) in its own VCN, with Docker,
# the service and Caddy for HTTPS. Everything here fits in Always Free: A1.Flex up to 4 OCPUs and 24 GB in total, 200 GB
# of block volume, one VCN, and outbound data up to 10 TB a month.
#
#   terraform init
#   terraform apply        # or `npm run deploy` from the project root, which passes .env's settings
#
# Each apply copies the current source to the server and rebuilds the container when the source or the settings
# changed. Nothing here holds a Stellar secret key: the service only knows its public PAY_TO address.

terraform {
  required_version = ">= 1.5"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
  }
}

provider "oci" {
  region              = var.region
  config_file_profile = var.oci_config_profile
}

locals {
  root        = abspath("${path.module}/../..")
  name        = var.name
  is_arm      = can(regex("A1", var.shape))
  site        = var.domain != "" ? var.domain : "${replace(oci_core_instance.app.public_ip, ".", "-")}.sslip.io"
  origin      = "https://${local.site}"
  source_hash = sha1(join("", [for file in sort(fileset(local.root, "{src/**,deploy/**,package.json,package-lock.json,tsconfig.json,Dockerfile,.dockerignore}")) : filesha1("${local.root}/${file}")]))
  env_file = join("\n", [
    "# Written by Terraform (infra/terraform). Change variables and apply again rather than editing this file.",
    "SITE_ADDRESS=${local.site}",
    "PUBLIC_ORIGIN=${local.origin}",
    "PAY_TO=${var.pay_to}",
    "AGENT_ID=${var.agent_id}",
    "STELLAR_NETWORK=${var.stellar_network}",
    "FACILITATOR_AUTH=${var.facilitator_auth}",
    "SOROBAN_RPC_URL=${var.soroban_rpc_url}",
    "PRICE_USDC=${var.price_usdc}",
    "LLM_BASE_URL=${var.llm_base_url}",
    "LLM_API_KEY=${var.llm_api_key}",
    "LLM_MODEL=${var.llm_model}",
    "LLM_VISION=${var.llm_vision}",
    "GITHUB_TOKEN=${var.github_token}",
    "RENDER_CONCURRENCY=${var.render_concurrency}",
    "RETENTION_SECONDS=${var.retention_seconds}",
    "",
  ])
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# The newest Ubuntu 24.04 image built for the chosen shape (arm64 for A1, x86 for E2.1.Micro).
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${local.name}-vcn"
  dns_label      = "ssvcn"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-public"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-public"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  ingress_security_rules {
    description = "SSH, for Terraform's deploys"
    protocol    = "6"
    source      = var.ssh_allowed_cidr
    tcp_options {
      min = 22
      max = 22
    }
  }

  dynamic "ingress_security_rules" {
    for_each = [80, 443]
    content {
      description = "HTTP(S): Caddy, and Let's Encrypt's challenge on 80"
      protocol    = "6"
      source      = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }

  ingress_security_rules {
    description = "Path MTU discovery"
    protocol    = "1"
    source      = "0.0.0.0/0"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.main.id
  cidr_block        = "10.42.1.0/24"
  display_name      = "${local.name}-public"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
}

resource "oci_core_instance" "app" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = local.name
  shape               = var.shape

  dynamic "shape_config" {
    for_each = local.is_arm ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_gbs
    }
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_ocid != "" ? var.image_ocid : data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "screenshots"
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }

  # A new image or cloud-init should not replace a running server: deploys go through terraform_data below.
  lifecycle {
    ignore_changes = [source_details[0].source_id, metadata["user_data"]]
  }
}

# Copies the source and settings to the server and (re)starts the containers whenever either changes.
resource "terraform_data" "deploy" {
  triggers_replace = [oci_core_instance.app.id, local.source_hash, sha1(local.env_file)]

  connection {
    type        = "ssh"
    host        = oci_core_instance.app.public_ip
    user        = "ubuntu"
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "10m"
  }

  provisioner "local-exec" {
    working_dir = local.root
    environment = { COPYFILE_DISABLE = "1" } # macOS tar: no ._ resource files
    command     = "mkdir -p infra/terraform/.build && tar --exclude='./node_modules' --exclude='./dist' --exclude='./data' --exclude='./out' --exclude='./infra' --exclude='./.git' --exclude='./.env' --exclude='./.env.*' --exclude='./jobs.sqlite*' -czf infra/terraform/.build/app.tar.gz ."
  }

  provisioner "remote-exec" {
    inline = [
      "cloud-init status --wait > /dev/null || true",
      "sudo mkdir -p /opt/app && sudo chown ubuntu:ubuntu /opt/app",
    ]
  }

  provisioner "file" {
    source      = "${path.module}/.build/app.tar.gz"
    destination = "/opt/app/app.tar.gz"
  }

  provisioner "file" {
    content     = local.env_file
    destination = "/opt/app/.env.deploy"
  }

  provisioner "remote-exec" {
    inline = [
      "set -e",
      "cd /opt/app && find . -mindepth 1 -maxdepth 1 ! -name app.tar.gz ! -name .env.deploy -exec rm -rf {} + && tar -xzf app.tar.gz && rm app.tar.gz",
      "mv /opt/app/.env.deploy /opt/app/deploy/.env && chmod 600 /opt/app/deploy/.env",
      "cd /opt/app/deploy && sudo docker compose build app",
      # Without PAY_TO the service can't start: Caddy comes up alone, so the address and its certificate are ready.
      "if grep -q '^PAY_TO=G' .env; then sudo docker compose up -d --remove-orphans; else sudo docker compose up -d caddy; echo 'PAY_TO is empty: run npm run launch, then deploy again.'; fi",
      "sudo docker image prune -f > /dev/null",
    ]
  }
}
