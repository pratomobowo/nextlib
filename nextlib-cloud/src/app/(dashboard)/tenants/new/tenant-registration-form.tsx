'use client'

import { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v4'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@/components/ui/field'

const tenantFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Nama institusi wajib diisi')
    .max(255, 'Nama tidak boleh lebih dari 255 karakter'),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug harus lowercase kebab-case (contoh: universitas-abc)')
    .max(100, 'Slug tidak boleh lebih dari 100 karakter')
    .optional()
    .or(z.literal('')),
  slims_base_url: z
    .string()
    .min(1, 'URL SLiMS wajib diisi')
    .url('Harus berupa URL yang valid (contoh: https://slims.kampus.ac.id)'),
})

type TenantFormData = z.infer<typeof tenantFormSchema>

interface RegistrationResult {
  id: string
  name: string
  slug: string
  status: string
  api_token: string
  created_at: string
}

export function TenantRegistrationForm() {
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TenantFormData>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      slims_base_url: '',
    },
  })

  const nameValue = watch('name')
  const slugValue = watch('slug')

  const generateSlugPreview = useCallback((name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }, [])

  const slugPreview = slugValue || generateSlugPreview(nameValue)

  const onSubmit = async (data: TenantFormData) => {
    setServerError(null)

    const payload: Record<string, string> = {
      name: data.name,
      slims_base_url: data.slims_base_url,
    }

    // Only include slug if explicitly provided
    if (data.slug) {
      payload.slug = data.slug
    }

    try {
      const response = await fetch('/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const responseData = await response.json()

      if (!response.ok) {
        if (responseData.code === 'VALIDATION_ERROR' && responseData.details) {
          setServerError(
            responseData.details
              .map((d: { path: string; message: string }) => `${d.path}: ${d.message}`)
              .join(', ')
          )
        } else {
          setServerError(responseData.message || 'Terjadi kesalahan saat membuat tenant')
        }
        return
      }

      setResult(responseData)
    } catch {
      setServerError('Gagal terhubung ke server. Periksa koneksi internet Anda.')
    }
  }

  if (result) {
    return <TokenDisplay result={result} />
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">Daftarkan Tenant Baru</CardTitle>
        <CardDescription>
          Hubungkan SLiMS kampus Anda ke NextLib Cloud
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          id="tenant-registration-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-5"
          noValidate
        >
          {serverError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </div>
          )}

          <Field data-invalid={!!errors.name || undefined}>
            <FieldLabel htmlFor="name">Nama Institusi</FieldLabel>
            <Input
              id="name"
              placeholder="Universitas Teknologi Indonesia"
              aria-required="true"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <FieldError id="name-error">{errors.name.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!errors.slug || undefined}>
            <FieldLabel htmlFor="slug">
              Slug <span className="text-muted-foreground font-normal">(opsional)</span>
            </FieldLabel>
            <Input
              id="slug"
              placeholder="universitas-teknologi-indonesia"
              aria-invalid={!!errors.slug}
              aria-describedby="slug-description slug-error"
              {...register('slug')}
            />
            <FieldDescription id="slug-description">
              {slugPreview ? (
                <>
                  Slug yang akan digunakan:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                    {slugPreview}
                  </code>
                </>
              ) : (
                'Akan digenerate otomatis dari nama institusi'
              )}
            </FieldDescription>
            {errors.slug && (
              <FieldError id="slug-error">{errors.slug.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!errors.slims_base_url || undefined}>
            <FieldLabel htmlFor="slims_base_url">URL SLiMS</FieldLabel>
            <Input
              id="slims_base_url"
              type="url"
              placeholder="https://slims.kampus.ac.id"
              aria-required="true"
              aria-invalid={!!errors.slims_base_url}
              aria-describedby={errors.slims_base_url ? 'url-error' : 'url-description'}
              {...register('slims_base_url')}
            />
            <FieldDescription id="url-description">
              Alamat server SLiMS kampus yang dapat diakses publik
            </FieldDescription>
            {errors.slims_base_url && (
              <FieldError id="url-error">{errors.slims_base_url.message}</FieldError>
            )}
          </Field>
        </form>
      </CardContent>

      <CardFooter>
        <Button
          type="submit"
          form="tenant-registration-form"
          disabled={isSubmitting}
          className="w-full"
          size="lg"
        >
          {isSubmitting ? 'Mendaftarkan...' : 'Daftarkan Tenant'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function TokenDisplay({ result }: { result: RegistrationResult }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.api_token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = result.api_token
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">Tenant Berhasil Dibuat</CardTitle>
        <CardDescription>
          Simpan token berikut. Token hanya ditampilkan sekali dan tidak dapat dilihat lagi.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Nama</span>
          <span className="text-sm text-muted-foreground">{result.name}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Slug</span>
          <code className="text-sm text-muted-foreground font-mono">{result.slug}</code>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">X-NextLib-Token</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs font-mono break-all">
              {result.api_token}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-label={copied ? 'Token disalin' : 'Salin token'}
            >
              {copied ? 'Tersalin!' : 'Salin'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Masukkan token ini di konfigurasi plugin NextLib-Agent pada SLiMS Anda.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
