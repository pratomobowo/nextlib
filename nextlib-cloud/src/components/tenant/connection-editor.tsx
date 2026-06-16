"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { RegenerateSecretModal } from "./regenerate-secret-modal";
import { TestConnectionButton } from "./test-connection-button";

const formSchema = z.object({
  name: z.string().min(1, "Nama institusi wajib diisi").max(255),
  slims_base_url: z
    .string()
    .refine(
      (v) => v === "" || /^https?:\/\/\S+/.test(v),
      "URL yang valid (contoh: https://slims.kampus.ac.id)"
    ),
  status: z.enum(["pending", "connected", "disconnected"]),
});

type FormData = z.infer<typeof formSchema>;

type Tenant = { id: string; name: string; slug: string; status: string };

export function ConnectionEditor({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [regenOpen, setRegenOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: tenant.name,
      slims_base_url: "",
      status: tenant.status as FormData["status"],
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch(`/api/v1/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || "Gagal menyimpan perubahan");
        return;
      }
      alert("Perubahan tersimpan");
      router.refresh();
    } catch {
      alert("Gagal terhubung ke server");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{tenant.name}</CardTitle>
              <CardDescription className="font-mono">
                {tenant.slug}
              </CardDescription>
            </div>
            <StatusBadge status={tenant.status} />
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="name">Nama Institusi</FieldLabel>
              <Input
                id="name"
                {...register("name")}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <FieldError>{errors.name.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!errors.slims_base_url || undefined}>
              <FieldLabel htmlFor="slims_base_url">URL SLiMS</FieldLabel>
              <Input
                id="slims_base_url"
                type="url"
                placeholder="https://slims.kampus.ac.id"
                {...register("slims_base_url")}
                aria-invalid={!!errors.slims_base_url}
              />
              {errors.slims_base_url && (
                <FieldError>{errors.slims_base_url.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!errors.status || undefined}>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <select
                id="status"
                {...register("status")}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="connected">Connected</option>
                <option value="disconnected">Disconnected</option>
              </select>
            </Field>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
              <TestConnectionButton tenantId={tenant.id} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API Token</CardTitle>
          <CardDescription>
            Token ini dipakai oleh plugin NextLib-Agent di SLiMS untuk autentikasi HMAC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs font-mono">
              xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
            </code>
            <Button variant="outline" onClick={() => setRegenOpen(true)}>
              Regenerate
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            ⚠ Token hanya ditampilkan sekali saat regenerate. Simpan dengan aman.
          </p>

          <div className="mt-4 flex items-center gap-2 border-t pt-4">
            <div className="flex-1 text-xs text-muted-foreground">
              Download plugin (ZIP dengan .env pre-baked untuk tenant ini).
              Tombol ini akan <strong>regenerate token</strong> + langsung download.
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (
                  confirm(
                    "Download plugin?\n\nToken lama akan langsung tidak valid. Plugin yang sudah ter-install di SLiMS harus di-update dengan token baru dalam 24 jam."
                  )
                ) {
                  window.location.href = `/api/v1/tenants/${tenant.id}/agent-zip`;
                }
              }}
            >
              Download Plugin
            </Button>
          </div>
        </CardContent>
      </Card>

      <RegenerateSecretModal
        open={regenOpen}
        onOpenChange={setRegenOpen}
        tenantId={tenant.id}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
        Connected
      </Badge>
    );
  }
  if (status === "disconnected") {
    return <Badge variant="destructive">Disconnected</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}
