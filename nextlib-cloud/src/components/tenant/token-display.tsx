"use client"

import { useState, useCallback } from "react"
import { Copy, Check, Download, ShieldAlert } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface TokenDisplayProps {
  token: string
  tenantName?: string
}

/**
 * Displays a generated API token after successful tenant registration.
 * The token is shown only once and provides copy-to-clipboard and download functionality.
 */
export function TokenDisplay({ token, tenantName }: TokenDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const textarea = document.createElement("textarea")
      textarea.value = token
      textarea.setAttribute("readonly", "")
      textarea.style.position = "absolute"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [token])

  const handleDownload = useCallback(() => {
    const content = [
      `# NextLib Agent Token`,
      `# Tenant: ${tenantName || "Unknown"}`,
      `# Generated: ${new Date().toISOString()}`,
      `#`,
      `# Paste this token into your NextLib Agent config.php`,
      `# WARNING: This token is shown only once. Store it securely.`,
      ``,
      token,
      ``,
    ].join("\n")

    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `nextlib-token-${tenantName?.toLowerCase().replace(/\s+/g, "-") || "tenant"}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [token, tenantName])

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Token Generated</CardTitle>
        <CardDescription>
          Your NextLib Agent token has been created successfully.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Security warning */}
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
        >
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <p className="text-sm text-destructive">
            This token will only be shown once. Copy or download it now and
            store it securely. You will not be able to retrieve it later.
          </p>
        </div>

        {/* Token display */}
        <div className="relative">
          <pre
            className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-sm break-all whitespace-pre-wrap"
            aria-label="API token"
          >
            {token}
          </pre>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2"
            onClick={handleCopy}
            aria-label={copied ? "Token copied" : "Copy token"}
          >
            {copied ? (
              <Check className="size-3.5 text-green-600 dark:text-green-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </div>

        {/* Copy feedback */}
        {copied && (
          <p className="text-sm text-green-600 dark:text-green-400" aria-live="polite">
            Copied to clipboard
          </p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            aria-label={copied ? "Token copied" : "Copy token to clipboard"}
          >
            {copied ? (
              <Check data-icon="inline-start" className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy data-icon="inline-start" className="size-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy Token"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            aria-label="Download token as text file"
          >
            <Download data-icon="inline-start" className="size-3.5" aria-hidden="true" />
            Download Token
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
