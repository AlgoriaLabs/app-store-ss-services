output "public_ip" {
  value = oci_core_instance.app.public_ip
}

output "public_origin" {
  description = "Pass it to `npm run launch -- --url <this>`."
  value       = local.origin
}

output "manifest_url" {
  value = "${local.origin}/.well-known/stellar-agent-services.json"
}

output "ssh" {
  value = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}
