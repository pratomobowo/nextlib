"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface KBEntry {
  id: string
  tenantId: string
  title: string
  content: string
  category: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface Tenant {
  id: string
  name: string
  slug: string
}

export default function KnowledgeBasePage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selectedTenant, setSelectedTenant] = useState<string>("")
  const [entries, setEntries] = useState<KBEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState("")
  const [formContent, setFormContent] = useState("")
  const [formCategory, setFormCategory] = useState("")
  const [saving, setSaving] = useState(false)

  // Load tenants on mount
  useEffect(() => {
    async function loadTenants() {
      try {
        const res = await fetch("/api/v1/tenants")
        if (res.ok) {
          const data = await res.json()
          setTenants(data.data || [])
          if (data.data?.length > 0) {
            setSelectedTenant(data.data[0].id)
          }
        }
      } catch (error) {
        console.error("Failed to load tenants:", error)
      }
    }
    loadTenants()
  }, [])

  // Load KB entries when tenant changes
  const loadEntries = useCallback(async () => {
    if (!selectedTenant) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/v1/whatsapp/knowledge-base?tenantId=${selectedTenant}`
      )
      if (res.ok) {
        const data = await res.json()
        setEntries(data.data || [])
      }
    } catch (error) {
      console.error("Failed to load KB entries:", error)
    } finally {
      setLoading(false)
    }
  }, [selectedTenant])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  // Create or update entry
  async function handleSave() {
    if (!formTitle.trim() || !formContent.trim()) return
    setSaving(true)

    try {
      if (editingId) {
        // Update
        await fetch("/api/v1/whatsapp/knowledge-base", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingId,
            title: formTitle,
            content: formContent,
            category: formCategory || null,
          }),
        })
      } else {
        // Create
        await fetch("/api/v1/whatsapp/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: selectedTenant,
            title: formTitle,
            content: formContent,
            category: formCategory || undefined,
          }),
        })
      }

      resetForm()
      await loadEntries()
    } catch (error) {
      console.error("Failed to save KB entry:", error)
    } finally {
      setSaving(false)
    }
  }

  // Toggle active status
  async function handleToggle(entry: KBEntry) {
    try {
      await fetch("/api/v1/whatsapp/knowledge-base", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, isActive: !entry.isActive }),
      })
      await loadEntries()
    } catch (error) {
      console.error("Failed to toggle entry:", error)
    }
  }

  // Delete entry
  async function handleDelete(id: string) {
    if (!confirm("Hapus entri ini dari basis pengetahuan?")) return
    try {
      await fetch(`/api/v1/whatsapp/knowledge-base?id=${id}`, {
        method: "DELETE",
      })
      await loadEntries()
    } catch (error) {
      console.error("Failed to delete entry:", error)
    }
  }

  // Edit entry
  function handleEdit(entry: KBEntry) {
    setEditingId(entry.id)
    setFormTitle(entry.title)
    setFormContent(entry.content)
    setFormCategory(entry.category || "")
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setFormTitle("")
    setFormContent("")
    setFormCategory("")
  }

  // Filter entries by search
  const filteredEntries = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase()) ||
      (e.category && e.category.toLowerCase().includes(search.toLowerCase()))
  )

  const categories = [
    { value: "", label: "Tanpa Kategori" },
    { value: "jam_buka", label: "Jam Buka" },
    { value: "aturan", label: "Aturan & Tata Tertib" },
    { value: "layanan", label: "Layanan" },
    { value: "pendaftaran", label: "Pendaftaran Anggota" },
    { value: "koleksi", label: "Koleksi & Katalog" },
    { value: "fasilitas", label: "Fasilitas" },
    { value: "lainnya", label: "Lainnya" },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/whatsapp"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Knowledge Base
          </h1>
          <p className="text-muted-foreground">
            Kelola basis pengetahuan untuk AI Pustakawan Virtual
          </p>
        </div>

        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tambah Entri
        </button>
      </div>

      {/* Tenant selector + Search */}
      <div className="flex gap-4">
        <select
          value={selectedTenant}
          onChange={(e) => setSelectedTenant(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari entri..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "Edit Entri" : "Tambah Entri Baru"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Judul</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Contoh: Jam Buka Perpustakaan"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Kategori</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Konten</label>
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Tuliskan informasi yang akan digunakan AI untuk menjawab pertanyaan..."
                rows={6}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !formTitle.trim() || !formContent.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Menyimpan..." : editingId ? "Perbarui" : "Simpan"}
              </button>
              <button
                onClick={resetForm}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted transition-colors"
              >
                Batal
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="py-4">
                <div className="h-5 w-48 bg-muted rounded mb-2" />
                <div className="h-4 w-full bg-muted rounded mb-1" />
                <div className="h-4 w-2/3 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {entries.length === 0
                ? "Belum ada entri di basis pengetahuan. Tambahkan FAQ, informasi, dan aturan perpustakaan."
                : "Tidak ditemukan entri yang cocok."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => (
            <Card
              key={entry.id}
              className={`transition-all ${!entry.isActive ? "opacity-60" : ""}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm">{entry.title}</h3>
                      {entry.category && (
                        <Badge variant="secondary" className="text-xs">
                          {categories.find((c) => c.value === entry.category)?.label ||
                            entry.category}
                        </Badge>
                      )}
                      {!entry.isActive && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Nonaktif
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {entry.content}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(entry)}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title={entry.isActive ? "Nonaktifkan" : "Aktifkan"}
                    >
                      {entry.isActive ? (
                        <ToggleRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(entry)}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title="Hapus"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
