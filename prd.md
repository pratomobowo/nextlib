Berikut adalah versi lengkap **Product Requirement Document (PRD) NextLib SaaS** yang sudah diformat ke dalam bentuk kode Markdown (`.md`) murni.

Lu tinggal *copy* isi kotak kode di bawah ini dan langsung *paste* ke file `PRD.md` di dalam repositori proyek lu, bro!

```markdown
# Product Requirement Document (PRD)

**Project Name:** NextLib SaaS (Hybrid SaaS Automation for SLiMS Ecosystem)  
**Document Version:** 1.2 (Final Comprehensive Specification)  
**Date:** June 12, 2026  
**Author:** Pratomo Bowo Leksono  
**Status:** Approved for Development / Sprint 1 Kickoff  

---

## 1. Pendahuluan & Tujuan Strategis

### 1.1 Latar Belakang
Akreditasi perpustakaan perguruan tinggi di Indonesia (Standar LAP-Perpusnas) memberikan bobot nilai yang besar pada komponen otomatisasi layanan, aksesibilitas digital, dan integrasi sistem antar-lembaga. *Senayan Library Management System (SLiMS)* secara standar telah memenuhi kebutuhan sirkulasi dasar, namun memiliki keterbatasan bawaan (*gap*) dalam hal:
1. Integrasi otomatis (real-time) dengan Sistem Informasi Akademik (SIAKAD) kampus.
2. Penyediaan dashboard analitik prediktif dan format laporan yang siap cetak sesuai instrumen borang akreditasi.
3. Layanan interaktif modern berbasis *Artificial Intelligence* (AI) untuk civitas akademika.
4. Portal pencarian terpadu (*Federated Search*) yang menghubungkan SLiMS dengan Repositori Skripsi (EPrints/DSpace) dan Jurnal Ilmiah (OJS).

### 1.2 Tujuan Produk
**NextLib SaaS** hadir sebagai platform *Hybrid SaaS* (Next.js & PHP Agent) yang menjembatani keterbatasan tersebut melalui pendekatan **Privacy-First Architecture**. Platform ini menyediakan otomatisasi canggih, mesin pencari satu pintu, dan analitik borang instan tanpa mengkloning data pribadi sensitif milik universitas ke server *cloud* pihak ketiga.

---

## 2. Arsitektur Data (Privacy-First Policy)

Untuk menjamin kedaulatan data kampus dan kepatuhan penuh terhadap UU Pelindungan Data Pribadi (UU PDP), arsitektur manajemen data NextLib SaaS dibagi menjadi tiga kluster:

| Kategori Data | Jenis Data | Mekanisme Penyimpanan | Jalur Komunikasi |
| :--- | :--- | :--- | :--- |
| **Personally Identifiable Information (PII)** | Nama, NIM/NIDN, Nomor HP, Email Mahasiswa, Riwayat Peminjaman Spesifik, Judul Buku yang Sedang Dipinjam. | **TIDAK DISIMPAN** di Cloud NextLib SaaS. Data murni tetap berada di database SLiMS lokal kampus. | *Real-time API Bridge* (Data hanya lewat di memori server Next.js lalu langsung dibuang). |
| **Data Agregat / Statistik** | Jumlah pengunjung harian, total buku dipinjam/kembali per hari, total nominal denda kolektif, angka pertumbuhan judul buku. | **DISIMPAN** di database NextLib SaaS untuk keperluan visualisasi tren jangka panjang dan borang. | Di-push via *Cron-job/Webhook* terjadwal dari plugin kampus setiap pukul 23.59 WIB. |
| **Kredensial Sistem** | API Key Kampus, WhatsApp Session Token, Base URL SLiMS, URL OAI-PMH EPrints, URL API OJS. | **DISIMPAN & DI-ENCRYPT** di database NextLib SaaS menggunakan standar industri. | HTTPS dengan enkripsi dua arah (AES-256). |

---

## 3. User Personas & User Journeys

### 3.1 Personas
1. **Pak Ahmad (Kepala Perpustakaan Universitas):** Membutuhkan visualisasi data instan untuk kebutuhan borang akreditasi tanpa harus merekap data manual dari sistem yang terpisah-pisah.
2. **Andi (IT Sysadmin Kampus):** Sangat protektif terhadap keamanan server kampus. Menolak produk yang mengharuskan modifikasi pada *core code* SLiMS atau sinkronisasi database keluar.
3. **Budi (Mahasiswa):** Pengguna akhir yang menginginkan kemudahan akses pencarian buku dan layanan mandiri secepat membalas chat WhatsApp.

### 3.2 Key User Journeys
* **Proses Onboarding & Aktivasi (Andi - IT Sysadmin):**  
  Andi mendaftar di NextLib SaaS $\rightarrow$ Membuat tenant kampus $\rightarrow$ Mendapatkan `X-NextLib-Token` $\rightarrow$ Mengunduh folder `nextlib-agent` $\rightarrow$ Memasukkannya ke direktori `plugins/` SLiMS lokal $\rightarrow$ Memasukkan token di halaman admin SLiMS $\rightarrow$ Status koneksi *Green/Connected* di dashboard NextLib.
* **Evaluasi & Cetak Borang (Pak Ahmad):**  
  Pak Ahmad login ke Dashboard NextLib SaaS $\rightarrow$ Masuk ke menu "Akreditasi Kriteria 5" $\rightarrow$ Melihat grafik peminjaman tahunan $\rightarrow$ Klik tombol "Export Borang (.xlsx/.pdf)" $\rightarrow$ Dokumen siap cetak diunduh sesuai standar Perpusnas.
* **Pencarian Terpadu Satu Pintu (Budi - Mahasiswa):**  
  Budi membuka halaman `search.univ-abc.ac.id` (Hosted Landing Page NextLib) $\rightarrow$ Mengetik "Artificial Intelligence" $\rightarrow$ Backend Next.js menembak SLiMS, EPrints, dan OJS secara bersamaan $\rightarrow$ Budi mendapatkan hasil pencarian buku fisik, skripsi PDF, dan jurnal sekaligus di satu halaman.

---

## 4. Spesifikasi Fungsional (Detailed Requirements)

### 4.1 Modul A: NextLib-Agent (SLiMS Plugin Side - PHP)
* **FR-A.1: Zero Core Modification**  
  Plugin harus berjalan murni sebagai ekstensi di dalam folder `plugins/` SLiMS 9 Bulian ke atas tanpa mengubah satu baris pun file *core* asli SLiMS.
* **FR-A.2: Secure API Endpoints Expansion**  
  Plugin mendaftarkan rute (endpoints) API baru pada SLiMS yang dilindungi oleh *Middleware* pengecekan header `X-NextLib-Token`. Endpoints meliputi:
  * `/api/v1/nextlib/search-book` (Kueri pencarian bibliografi real-time).
  * `/api/v1/nextlib/member-check` (Pengecekan status keanggotaan & denda aktif).
  * `/api/v1/nextlib/extend-book` (Eksekusi pembaruan masa pinjam buku).
* **FR-A.3: Automated Aggregate Data Exporter**  
  Menyediakan fungsi otomatis (pemicu berbasis *cron*) untuk menghitung total statistik harian (Query: `COUNT visitor`, `COUNT loan`) dan mengirimkannya ke NextLib SaaS dalam bentuk payload JSON terkompresi.

### 4.2 Modul B: NextLib-Cloud (Central SaaS Server Side - Next.js)
* **FR-B.1: Multi-Tenant Architecture**  
  Sistem harus mampu menangani banyak institusi kampus (Multi-tenant) dengan isolasi data konfigurasi tenant yang ketat menggunakan indeks `tenant_id`.
* **FR-B.2: Real-time API Proxy / Router Engine**  
  Menyediakan *stateless router* yang mengarahkan *request* dari chatbot atau portal pencarian langsung ke server SLiMS kampus tujuan secara *in-memory* tanpa menyimpannya ke *hard drive* server SaaS.
* **FR-B.3: Dashboard Analitik & Borang Engine**  
  * Mengolah data agregat harian menjadi grafik interaktif performa perpustakaan per bulan/tahun menggunakan *ApexCharts*.
  * **Fitur Utama:** Generator Borang Akreditasi otomatis yang mengonversi data sirkulasi ke dalam bentuk tabel baku format `.xlsx` dan `.pdf` siap lampir/cetak.

### 4.3 Modul C: AI Virtual Librarian Engine (WA Gateway Integration)
* **FR-C.1: Multi-Tenant WhatsApp Gateway Session**  
  SaaS menyediakan modul manajemen sesi WhatsApp (*baileys* / *whatsapp-web.js*). Setiap kampus bisa men-scan QR Code dari nomor WhatsApp resmi perpustakaan mereka sendiri di dashboard SaaS.
* **FR-C.2: Intent Classifier & LLM Processing (Agentic AI)**  
  * **Intent FAQ:** Jika pesan berupa pertanyaan umum (jam buka, aturan perpus), AI menjawab menggunakan *Knowledge Base* dokumen aturan kampus yang di-upload di SaaS.
  * **Dynamic Querying:** Jika pesan berupa kueri sirkulasi (*"Cek denda NIM 2201002"*), SaaS mengubahnya menjadi tembakan API ke *NextLib-Agent* kampus bersangkutan.
  * **Natural Formatting:** Hasil mentah JSON dari SLiMS dibungkus kembali oleh LLM (OpenAI/Ollama) agar memiliki gaya bahasa yang natural dan sopan sebelum dikirim ke WA mahasiswa.

### 4.4 Modul D: NextLib Federated Discovery Engine (Pencarian Terpadu)
* **FR-D.1: Multi-Source Connector Platform**  
  Dashboard SaaS menyediakan input URL untuk mengubungkan platform luar milik kampus:
  * OAI-PMH Base URL (Untuk EPrints / DSpace - Skripsi).
  * REST API / RSS Feed Endpoint (Untuk Open Journal Systems - Jurnal).
* **FR-D.2: Concurrent Real-time Query Aggregator**  
  Backend Next.js wajib menggunakan proses *asynchronous concurrent request* (`Promise.all`) saat menerima satu kata kunci, untuk menembak SLiMS, EPrints, dan OJS sekaligus demi memangkas *latency*.
* **FR-D.3: Unified Data Normalization**  
  Sistem melakukan *parsing* dari berbagai format respons (JSON SLiMS, XML OAI-PMH, RSS OJS) menjadi satu struktur JSON yang seragam sebelum ditampilkan atau dikirim ke chatbot.

### 4.5 Modul E: Public Search Interface & API Gateway
* **FR-E.1: White-Label Search Landing Page**  
  Next.js menyediakan halaman publik dynamic route (`/search/[tenant_slug]`) dengan desain minimalis (ala Google Search) yang menampilkan kolom pencarian terpadu. Kampus dapat mengustomisasi logo, judul, dan warna dasar tema (Tailwind CSS) sesuai identity almamater.
* **FR-E.2: Custom Domain Mapping**  
  Sistem mendukung konfigurasi *CNAME record mapping* agar halaman pencarian terpadu dapat diakses menggunakan subdomain resmi universitas (contoh: `https://pencarian.univ-abc.ac.id`).
* **FR-E.3: Authenticated Developer API Endpoint**  
  SaaS menyediakan endpoint publik (`GET /v1/search?q=keyword`) yang dilindungi *Public API Key* agar tim IT internal kampus bisa mengambil data JSON pencarian terpadu NextLib dan menampilkannya di website utama rektorat mereka sendiri.

---

## 5. Spesifikasi Non-Fungsional (Non-Functional Requirements)

* **NFR-1: Keamanan & Kepatuhan Hukum (Security & Compliance)**  
  * Seluruh payload komunikasi antara *NextLib-Cloud* dan *NextLib-Agent* wajib menggunakan HTTPS + enkripsi token dinamis berbasis `HMAC-SHA256`.
  * Sistem wajib mematuhi UU PDP: Tidak ada penyimpanan log data teks chat WA yang mengandung PII secara permanen di server SaaS.
* **NFR-2: Performa & Toleransi Kegagalan (Performance & Fault Tolerance)**  
  * *API Timeout Limit:* Batas maksimal menunggu respons server kampus adalah 5 detik. Jika server kampus mati, sistem harus merespons dengan pesan *fallback* yang elegan: *"Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan."*
  * *Rate Limiting:* Endpoint API Publik developer dipatok maksimal 100 request per menit per API Key menggunakan Redis Rate Limiter untuk mencegah serangan DDoS.
  * *Queue System:* Manajemen antrean pesan WhatsApp wajib menggunakan *Redis Queue* (BullMQ) untuk menghindari penumpukan beban *request* saat jam sibuk perkuliahan.
* **NFR-3: Kompatibilitas Lingkungan (Compatibility)**  
  * *NextLib-Agent* (Plugin PHP) harus berjalan lancar di versi PHP 7.4, 8.0, 8.1, dan 8.2.

---

## 6. Timeline & Strategi Rilis MVP (Minimum Viable Product)

Pengembangan NextLib SaaS dipatok selama 6 minggu dengan pembagian sprint sebagai berikut:


```

[ Sprint 1: Core & Plugin Agent ] ──> [ Sprint 2: AI & WA Engine ] ──> [ Sprint 3: Federated Search & Launch ]

```

1. **Sprint 1 (Minggu 1-2): Core Tenant & Agent Plugin**  
   * Setup arsitektur multi-tenancy di Next.js.
   * Pembuatan plugin `nextlib-agent` (PHP) dan implementasi keamanan token header.
   * Uji coba jabat tangan (*handshake*) API antara SaaS dan SLiMS lokal.
2. **Sprint 2 (Minggu 3-4): AI Librarian & WhatsApp Engine**  
   * Implementasi WhatsApp Gateway (QR Code scanner) di dashboard Next.js.
   * Integrasi LLM Engine untuk *Intent Classification* (Membedakan pertanyaan FAQ vs Sirkulasi Buku).
   * Uji coba transaksi sirkulasi (cek denda & cari buku) via WhatsApp.
3. **Sprint 3 (Minggu 5-6): Federated Search, Landing Page, & Borang Exporter**  
   * Pembuatan parser XML OAI-PMH untuk EPrints dan REST API untuk OJS.
   * Pembuatan Halaman Landing Page Publik (`/search/[tenant_slug]`) dan dashboard ekspor borang akreditasi.
   * *Security Hardening*, Uji Coba Beta ke 1-2 kampus mitra, dan rilis komersial.

```

---

Dokumennya sudah rapi, bro. Ada file atau bagian kode pertama yang mau lu bahas buat dieksekusi sekarang?