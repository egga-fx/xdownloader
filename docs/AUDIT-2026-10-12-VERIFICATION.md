# Verifikasi Audit xDownloader — 12 Oktober 2026

Dokumen ini memverifikasi `docs/AUDIT-2026-10-12.md` (209 baris, 24 temuan B01–B24) terhadap kode project xdownloader.

## Kesimpulan

**Audit akurat dan dapat dipercaya.** Seluruh 24 temuan terverifikasi secara struktural terhadap kode aktual. Seluruh 3 klaim validasi (bun test, cargo test, build) berhasil direproduksi dengan angka yang identik. Tidak ditemukan temuan yang salah, berlebihan, atau fabrikasi.

- **24/24 temuan** terkonfirmasi ada di kode (bukti file:baris benar).
- **3/3 klaim validasi** direproduksi persis (angka cocok).
- **1 catatan minor**: satu nomor baris meleset 1 baris (`downloader.rs:752` → sebenarnya 753). Tidak mengubah substansi.
- **1 catatan basis**: nomor baris audit cocok dengan **HEAD/committed**, bukan working tree saat ini.

## Metode verifikasi

1. Snapshot deterministik baseline: `git archive HEAD | tar -x` → `%LOCALAPPDATA%/Temp/xdaudit`.
   Dilakukan karena `downloader.rs` sedang dimodifikasi live oleh proses lain selama sesi ini.
2. Cek setiap referensi `file:baris` audit dengan `sed -n "<N>p"` pada snapshot.
3. Baca konteks sekitar setiap referensi (±30 baris) untuk memverifikasi **substansi** klaim, bukan sekadar keberadaan baris.
4. Jalankan ulang seluruh perintah validasi yang diklaim audit.
5. Simulasi langsung predikat cleanup (B02) untuk membuktikan hazard-nya.

## Hasil validasi (dijalankan ulang)

| Pemeriksaan | Klaim audit | Hasil verifikasi | Status |
| --- | --- | --- | --- |
| `bun test tests` | 70 lulus, 0 gagal | **70 pass, 0 fail** (3 file) | ✅ Cocok |
| `cargo test --lib --offline --locked` | 69 lulus, 0 gagal, 5 diabaikan | **69 passed; 0 failed; 5 ignored** (5.24s) | ✅ Cocok |
| `bun run build` — JS | 461,63 kB / gzip 124,99 kB | **461,63 kB / gzip 124,99 kB** | ✅ Cocok |
| `bun run build` — CSS | 73,71 kB | **73,71 kB** | ✅ Cocok |
| Durasi build Vite | 11,22 detik | 4m30s (cold + mesin terkontensi) | ⚠️ Lingkungan, bukan substansi |

Catatan: `test image_extractor::tests::test_parse_real_threads_html_file ... ok` **lulus** meski fixture tidak ada — ini bukti langsung temuan B24 (tes lulus tanpa assertion).

## Verifikasi per temuan

### P1 (B01–B07, B09)

| ID | Klaim | Bukti yang diverifikasi | Status |
| --- | --- | --- | --- |
| **B01** | `sweep_orphaned_temp_files` dipanggil tiap unduhan dimulai; predikat tidak cek kepemilikan/usia | `downloader.rs:258` — `sweep_orphaned_temp_files(&out_dir)` tepat di awal `run_download`, setelah `create_dir_all`. Predikat sweep di `:149`. | ✅ Terkonfirmasi |
| **B02** | Cleanup bisa hapus file final valid; contoh `my.film` → `my.film.mp4` | Predikat `:138` = `matches_stem && name.contains(".f") && endswith(.mp4/.m4a/.webm)`. Cleanup di `:935` berjalan **sebelum** `file_size` disimpan di `:937`. **Simulasi langsung: `my.film.mp4` + stem `my.film` → `DELETED = True`.** | ✅ Terkonfirmasi + dibuktikan |
| **B03** | `std::process::Command` + blocking loop di dalam `tokio::spawn` | `Command::new` di `:596`; `BufReader::new(stdout)` di `:749`; `for line_res in reader.lines()` di `:753` — loop blocking **di thread async** (bukan `spawn_blocking`); `child.wait()` di `:836`; `stderr_handle.join()` di `:837`. | ✅ Terkonfirmasi |
| **B04** | Hasil `run_download` diabaikan → sebagian error tak kirim terminal event | `lib.rs:80` — `let _ = downloader::run_download(...)` di dalam `tokio::spawn`; hanya `process_mgr_clone.remove()` setelahnya. `start_download` sudah `Ok(task_id)` sebelumnya. | ✅ Terkonfirmasi |
| **B05** | Protokol cancel tidak konsisten | `cancel_download` (`lib.rs:108`) hanya `process_mgr.cancel()`, tak menulis status `cancelled`. `ProcessManager::remove` menghapus `children` + `native_tasks` sekaligus. FFmpeg di `transcriber.rs:1160` didaftarkan dengan `task_id` asli, sedangkan `cancel_transcription` (`lib.rs:277`) membunuh `{task_id}_audio`. | ✅ Terkonfirmasi |
| **B06** | Nama output tanpa proteksi collision; template tanpa task ID | `downloader.rs:450` — `out_dir.join(format!("{}.%(ext)s", clean))` (tanpa ID). Foto ditulis ke nama final di `image_extractor.rs:1551`. | ✅ Terkonfirmasi |
| **B07** | Updater melewati verifikasi signature | `tauri-api.ts:1360` — hasil native `check_for_app_update` dikembalikan **sebelum** plugin signed updater. `tauri-api.ts:1459` → `install_app_update_from_url` (`lib.rs:311`) mengunduh EXE lalu `let _ = Command::new(&installer_path).spawn(); std::process::exit(0);` — **hasil spawn diabaikan, tanpa verifikasi signature**. | ✅ Terkonfirmasi |
| **B09** | Subtitle bisa dilaporkan sukses meski publish gagal | `transcriber.rs:1017` — `let _ = tokio::fs::rename(&srt_tmp, &srt_path).await;` (error diabaikan) untuk SRT/VTT/TXT, lalu record `completed` dibuat. Ukuran fallback ke `srt_content.len()`. | ✅ Terkonfirmasi |

### P2 (B08, B10–B24)

| ID | Klaim | Bukti yang diverifikasi | Status |
| --- | --- | --- | --- |
| **B08** | Bundle mengabaikan pilihan audio/quality/time range | `image_extractor.rs:1717` — signature `download_media_bundle(app, db, task_id, bundle, output_folder, custom_name, selected_indices)` — **tidak ada** `format_type`/`quality`/`time_range`. Dipanggil dari `downloader.rs:290` dan `:376`. | ✅ Terkonfirmasi |
| **B10** | UI menawarkan 360p tapi backend tak punya case-nya | `types.ts:20` — `DownloaderQuality` memuat `"360p"`. `downloader.rs:659` — `match quality` hanya `4k/1440p/1080p/720p/480p/_`; `360p` jatuh ke `_` (= best). `App.tsx:482` — `best` diganti `defaultVideoQuality`. | ✅ Terkonfirmasi |
| **B11** | Batas 2 tugas hanya di frontend; slot tak dicadangkan sebelum await; effect `[]` menangkap settings awal | `MAX_CONCURRENT_DOWNLOADS = 2` hanya di `App.tsx:84/509/519`. Slot baru masuk `activeTasks` **setelah** `await startDownload(...)` (`App.tsx:537` → set di `:557`). Listener `App.tsx:227` ditutup `}, []);` di `:328` dan memanggil `dequeueAndStartNext` (closure stale). | ✅ Terkonfirmasi |
| **B12** | `checkUpdatesOnStartup=false` tetap diikuti; `autoClipboardDetect` tak diteruskan; polling tetap 1 detik | `checkUpdatesOnStartup` hanya ada di `types.ts`, `SettingsModal.tsx`, dan default `App.tsx:126` — **tidak pernah dibaca** oleh `loadInitialData` (`App.tsx:173` jalan tanpa syarat). `autoClipboardDetect` tak pernah dilewatkan ke `UrlInputSection`; `setInterval(runCheck, 1000)` di `UrlInputSection.tsx:77` tanpa gating dan tanpa guard in-flight. | ✅ Terkonfirmasi |
| **B13** | Studio punya diarize/tagEvents/maxChars tapi tak dikirim | State ada di `TranscriptStudioModal.tsx:81/84/87`, tapi `handleStart` (`:321`) hanya memanggil `startTranscription({url, languageCode, customName})`. `tauri-api.ts:1043` — params hanya `url/languageCode/customName/outputFolder/timeRange`. Rust `start_transcription` (`lib.rs:231`) juga tanpa parameter ini. **Dead options.** | ✅ Terkonfirmasi |
| **B14** | Timeout metadata membungkus `cmd.output()` tanpa kill | `metadata.rs:69` — `tokio::time::timeout(Duration::from_secs(20), cmd.output()).await` — child tidak di-kill saat timeout (tanpa `kill_on_drop`). | ✅ Terkonfirmasi |
| **B15** | `initialSelectedIndices` array baru → effect reset pilihan | `MetadataPreviewCard.tsx:766` — `initialSelectedIndices={[activeImageIndex]}` (literal array baru tiap render). `CarouselSelectionModal.tsx:29` — `useEffect(..., [isOpen, images, initialSelectedIndices])` mereset `selected`. | ✅ Terkonfirmasi |
| **B16** | Vault query + scan filesystem penuh; `Mutex<Connection>` menserialkan | `db.rs:8` — `conn: Mutex<Connection>`. `get_records` (`:248`) `ORDER BY created_at DESC` **tanpa LIMIT**; di dalam `query_map` closure dipanggil `Path::new(&file_path).exists()` **saat mutex dipegang** (`:273`); deteksi carousel juga `Path::new(...).exists()` (`:311-322`). `transcriber.rs:770` — `db.get_records(None,None,None)` lalu `.find(|r| r.id == audio_task_id)`. | ✅ Terkonfirmasi |
| **B17** | Upload menahan seluruh audio + salinan | `transcriber.rs:790` dan `:1214` — `tokio::fs::read(&audio_path)` membaca **seluruh file ke Vec**. | ✅ Terkonfirmasi |
| **B18** | Progress memicu render UI/history luas | `App.tsx:251` — reducer membuat `Map` baru tiap progress di root state. `MediaVaultDrawer` **selalu di-mount** (`App.tsx:876`, tanpa early-return di komponen). `MediaVaultDrawer.tsx:79` — `records.filter(isRecordCorruptOrMissing)` dihitung tiap render. | ✅ Terkonfirmasi |
| **B19** | Metadata diminta berulang | `handleUrlChange` (`App.tsx:330`) fetch langsung; `startDownload` (`App.tsx:439`) fetch lagi bila `!matchedInfo`. Tidak ada dedupe in-flight/cache. | ✅ Terkonfirmasi |
| **B20** | Delete DB hapus satu file & abaikan error; Clean Vault salah anggap record aktif | `db.rs:353` — `delete_record` hanya `SELECT file_path` (satu file), `let _ = fs::remove_file(path)` (error diabaikan). Sibling carousel/BGM/VTT/TXT tak tercatat. `MediaVaultDrawer.tsx:79` — `isRecordCorruptOrMissing` dihitung atas semua record. | ✅ Terkonfirmasi |
| **B21** | API key disimpan JSON di SQLite; CSP null; asset scope seluruh FS | `transcriber.rs:512` — `save_config` → `serde_json::to_string(cfg)` → `db.set_setting`. `StoredTranscriptionConfig` (`:329`) memuat `api_key: Option<String>`. Masking hanya di `to_public()`/`apiKeyHint`. `tauri.conf.json:33` — `"csp": null`, `assetProtocol.scope: ["**"]`. | ✅ Terkonfirmasi |
| **B22** | Foto tidak cek MIME; timeout 60s dibagi | `image_extractor.rs:1822` — hanya `if !resp.status().is_success()`, tanpa cek `Content-Type`/MIME. `SHARED_HTTP_CLIENT` (`:52`) — `.timeout(Duration::from_secs(60))` global untuk scraping dan bundle. | ✅ Terkonfirmasi |
| **B23** | Setup/logging/carousel kurang efisien | `App.tsx:149` — `loadInitialData` `await checkBinariesStatus()` sebelum settings/history. `binaries.rs:268` — `fs::File::create` + `file.write_all` (blocking std `io::Write`) di dalam fungsi async. `logger.rs:47` — `write_file_log` buka file + cek rotasi tiap event (`LOG_MUTEX` global). `image_extractor.rs:1507` — loop `for ... items_to_download` sekuensial. | ✅ Terkonfirmasi |
| **B24** | Fixture tes absolute path; tak ada CI; klaim README berlebih | `image_extractor.rs:2548` — `test_parse_real_threads_html_file` membaca `C:/Users/precore/.gemini/antigravity-ide/brain/.../threads_multi.html`; bila gagal baca → `if let Ok` tak jalan → **tes lulus tanpa assertion** (terbukti di run cargo). Hanya `.github/workflows/release.yml`. `README.md:20` — "100% lokal … Tidak ada data media atau metadata yang dikirimkan ke server pihak ketiga" padahal STT mengunggah audio ke ElevenLabs. | ✅ Terkonfirmasi |

## Catatan & diskrepansi

1. **Basis baris = HEAD, bukan working tree.** Seluruh referensi `file:baris` audit cocok **persis** dengan `git show HEAD:...`, sedangkan working tree sudah menyimpang (`downloader.rs` +155 baris vs committed). Artinya nomor baris audit mengacu ke baseline **committed**, bukan working tree pasca-audit. Audit menyatakan memakai "working tree aktual, termasuk 14 file perubahan lokal"; kemungkinan pada saat audit (01:15) file-file inti memang masih bersih = HEAD.

2. **Repo dimodifikasi live selama verifikasi.** Audit mtime `2026-10-12 01:15:31`. Saat verifikasi, `git status` berubah dari 5 → 10 file termodifikasi (`db.rs`, `downloader.rs`, `image_extractor.rs`, `lib.rs`, `App.tsx`, `MediaVaultDrawer.tsx`, `VaultHistoryGrid.tsx`, `VaultHistoryTable.tsx`, `tauri-api.ts`, `types.ts`). Karena itu verifikasi dilakukan terhadap snapshot `git archive HEAD` agar deterministik.

3. **Satu nomor baris meleset.** Audit menunjuk "Loop stdout" di `downloader.rs:752`; aktual di HEAD `for line_res in reader.lines()` ada di **753** (baris 752 kosong). Off-by-one, tidak mengubah substansi.

4. **Durasi build.** Audit melaporkan 11,22 detik; verifikasi 4m30s karena cold build di mesin terkontensi. Ukuran artefak identik, jadi ini perbedaan lingkungan.

5. **Kualitas audit tinggi.** Audit tidak hanya benar soal wiring, tapi juga tepat membedakan tingkat keyakinan (mis. "keyakinan tinggi pada collision; skenario reuse MP3 perlu reproduksi yt-dlp" untuk B06), dan tidak mengklaim angka percepatan yang tak terukur.

## Kesimpulan akhir

Audit `AUDIT-2026-10-12.md` **valid**. Prioritas P1 yang disebut (B01/B02/B06/B09/B20 untuk integritas file; B03/B04/B05/B11/B14 untuk lifecycle) memang berdasar pada bug nyata di kode. Rekomendasi urutan implementasi di audit dapat diikuti apa adanya.
