-- Fixture buatan sendiri (BUKAN data nyata) meniru struktur sistem lama untuk tes impor. Kolom hanya yang dipakai impor.
CREATE TABLE country (id BIGINT PRIMARY KEY, name VARCHAR(100), updated_at TIMESTAMP NULL, Code INT NULL);
CREATE TABLE pelabuhan (id BIGINT PRIMARY KEY, name VARCHAR(100), code VARCHAR(6), location_city VARCHAR(100), id_country INT, jenis TINYINT DEFAULT 0);
CREATE TABLE warehouse (id INT PRIMARY KEY, code VARCHAR(6), name VARCHAR(100), location VARCHAR(50), id_country INT);
CREATE TABLE customer (id BIGINT PRIMARY KEY, name VARCHAR(100), nickname VARCHAR(100), email VARCHAR(100), phone VARCHAR(50), address VARCHAR(200), code VARCHAR(100), kota VARCHAR(50), taxno VARCHAR(20));
CREATE TABLE vendor (id BIGINT PRIMARY KEY, name VARCHAR(100), code VARCHAR(6), location_city VARCHAR(100), id_country INT, jenis TINYINT DEFAULT 0, npwp VARCHAR(25), pic VARCHAR(50));
CREATE TABLE shipper (id BIGINT PRIMARY KEY, name VARCHAR(100), location_city VARCHAR(100), id_country INT DEFAULT 0);
CREATE TABLE users (id BIGINT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100), password VARCHAR(255), uname VARCHAR(100), level_admin INT, code VARCHAR(5));
CREATE TABLE job_order (id BIGINT PRIMARY KEY, JobOrderType TINYINT, Tanggal DATE, Invoice VARCHAR(50), IdCustomer INT, ImportType VARCHAR(20), ShpGCoAgent_id INT, NoBL VARCHAR(50), NoBLDate DATE, NoHbl VARCHAR(50), HblDate DATE,
  NoBc2 VARCHAR(50), NoBc2Date DATE, Consignee VARCHAR(50), NoSiDo VARCHAR(50), NoSiDoDate DATE, NoPib VARCHAR(50), DateEta DATE, DateEtd DATE, Vessel VARCHAR(50), PortofLoading_id INT, PortofDestination_id INT, WareHouseTps_id INT,
  User_id INT, Remark VARCHAR(500), Spk VARCHAR(100), SpkDate DATE, NoJobOrder INT UNIQUE, StatusJo TINYINT DEFAULT 0, DateCreated DATETIME, id_shipper INT, jenis_party VARCHAR(3), fcl_20 INT DEFAULT 0, fcl_40 INT DEFAULT 0, fcl_45 INT DEFAULT 0,
  fcl_ot INT DEFAULT 0, fcl_fr INT DEFAULT 0, lcl_ton FLOAT DEFAULT 0, lcl_m3 FLOAT DEFAULT 0, lcl_qty FLOAT DEFAULT 0, lcl_satuan_qty VARCHAR(10), JobCompleteDate DATE, NoAju VARCHAR(25));
CREATE TABLE worksheet (id BIGINT PRIMARY KEY, tanggal DATE, nomor VARCHAR(75), created_by INT, remark VARCHAR(300));
CREATE TABLE kontainer (id BIGINT PRIMARY KEY, nomor VARCHAR(50), tanggal DATE, size VARCHAR(25), tujuan VARCHAR(100), trucking VARCHAR(50), no_polisi VARCHAR(15), tarif INT, id_job_order BIGINT, weight FLOAT, qty INT, satuan VARCHAR(20),
  weight_unit VARCHAR(10), damage_status TINYINT, damage_descr VARCHAR(100), nett_weight FLOAT DEFAULT 0, nett_weight_unit VARCHAR(10), descr_barang VARCHAR(100), spec VARCHAR(50), thickness VARCHAR(50), remark VARCHAR(100),
  id_worksheet BIGINT, id_surat_jalan BIGINT DEFAULT 0, thickness_a VARCHAR(50) DEFAULT '', thickness_b VARCHAR(50) DEFAULT '', thickness_c VARCHAR(50) DEFAULT '', dari VARCHAR(20), updated_time DATETIME);
CREATE TABLE surat_jalan (id BIGINT PRIMARY KEY, nomor VARCHAR(10), tanggal DATE, nm_sopir VARCHAR(25), no_pol VARCHAR(25), tujuan VARCHAR(100), no_telp_sopir VARCHAR(15), id_vendor INT, status_kirim TINYINT DEFAULT 0, alamat_pengirim VARCHAR(100), id_user INT, date_created DATETIME, date_finish DATETIME);
CREATE TABLE surat_jalan_detil (id BIGINT PRIMARY KEY, id_surat_jalan BIGINT, id_kontainer BIGINT, qty INT DEFAULT 0, id_job_order BIGINT, flag_surat_jalan INT DEFAULT 1);

INSERT INTO country VALUES (1,'INDONESIA',NULL,62),(2,'KOREA',NULL,82);
INSERT INTO pelabuhan VALUES (1,'TANJUNG PRIOK','IDTPP','JAKARTA',1,0),(2,'KWANGYANG','KRKAN','KWANGYANG',2,1);
INSERT INTO warehouse VALUES (1,'TPS1','TPS SATU','JAKARTA',1);
INSERT INTO customer VALUES (1,'PT UNITED STEEL SERVICE INDONESIA','usc','usc@example.test','021','Jl. A','USC1','Jakarta','01.234'),(2,'PT BERKAH TRANS UTAMA','BTU',NULL,NULL,NULL,'-','Bekasi','-'),
  (3,'FADLAN PERSONAL','FADLAN','f@example.test',NULL,NULL,'-',NULL,NULL),(4,'CUSTOMER TANPA JO','XYZ','x@example.test',NULL,NULL,'XYZ',NULL,NULL);
INSERT INTO vendor VALUES (1,'MJL TRANS','MJL','Jakarta',1,0,'-','Pak Mulya'),(2,'MJL LAIN','MJL',NULL,0,0,NULL,NULL),(3,'PT Dharma Putra Sejati','-',NULL,0,0,NULL,NULL),(4,'VENDOR KODE KOSONG','',NULL,0,0,NULL,NULL);
INSERT INTO shipper VALUES (1,'POSCO CORPORATION','Pohang',2),(2,'SHIPPER TANPA NEGARA',NULL,0);
INSERT INTO users VALUES (1,'Administrator','admin@mail.test','x','Admin',1,'AD'),(2,'Budi Santoso','budi@mail.test','x','budi',2,'BS'),(3,'Citra Dewi','budi@mail.test','x','CITRA',2,'CD'),(4,'Tanpa Kode','bukan-email','x','dodo',2,'TOOLG');
INSERT INTO job_order (id, JobOrderType, Tanggal, Invoice, IdCustomer, ImportType, NoBL, NoBLDate, NoHbl, HblDate, NoSiDo, NoSiDoDate, DateEta, DateEtd, Vessel, PortofLoading_id, PortofDestination_id, WareHouseTps_id, User_id, Remark, NoJobOrder, StatusJo, DateCreated, id_shipper, jenis_party,
  fcl_20, fcl_40, lcl_ton, lcl_m3, lcl_qty, lcl_satuan_qty, JobCompleteDate, NoAju) VALUES
 (101, 1, '2026-01-05', 'INV1, INV2', 1, 'PIB BC 2.0', 'BL1', '2026-01-02', 'HB1', '2026-01-03', 'SD1 dan SD2', '2026-01-04', '2026-01-20', '2026-01-10', 'MSC BEIRA', 2, 1, 1, 2, 'catatan satu', 27, 0, '2026-01-05 08:00:00', 1, 'FCL', 2, 1, 0, 0, 0, NULL, '2026-02-01', 'A1'),
 (102, 2, '2026-01-06', 'INV3', 2, 'PEB BC 3.0', NULL, NULL, NULL, NULL, 'PO-1', NULL, '2026-01-25', '2026-01-30', 'OOCL', 1, 0, 0, 3, NULL, 28, 1, '2026-01-06 09:00:00', 0, 'LCL', 0, 0, 2.76, 1.5, 300, 'CL', '2026-02-02', 'A2'),
 (103, 3, '2026-01-07', NULL, 3, 'Pilih', NULL, NULL, NULL, NULL, '-', NULL, NULL, NULL, NULL, 0, 0, 0, 2, NULL, 29, 2, '2026-01-07 10:00:00', 0, NULL, 0, 0, 0, 0, 12.5, 'BE', '2026-02-03', NULL),
 (104, 4, '2026-01-08', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, 30, 0, '2026-01-08 11:00:00', 0, NULL, 0, 0, 0, 0, 2, 'CT', NULL, NULL),
 (105, 1, '2026-01-09', NULL, 99, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, 31, 0, '2026-01-09 11:00:00', 0, NULL, 0, 0, 0, 0, 0, NULL, NULL, NULL),
 (106, 7, '2026-01-10', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, 32, 0, '2026-01-10 11:00:00', 0, NULL, 0, 0, 0, 0, 0, NULL, NULL, NULL);

INSERT INTO worksheet VALUES (1,'2026-01-10','202601001',2,NULL),(2,'2026-01-11','202601002',99,NULL),(3,'2026-02-01','202601001',2,NULL);
INSERT INTO kontainer (id, nomor, size, id_job_order, weight, qty, satuan, weight_unit, damage_status, damage_descr, nett_weight, nett_weight_unit, descr_barang, spec, thickness, id_worksheet, dari, tujuan, updated_time) VALUES
 (1, 'MSKU1234567', '20 F', 101, 8120, 1, 'Container', 'Kg', 1, NULL, 8000, 'Kg', 'GALVANIZED COIL', '1', '1.2', 1, 'KOREA', 'CIKARANG', '2026-01-12 10:00:00'),
 (2, 'C-2', '40 F', 101, 8.14, 2, 'COIL', 'Ton', 2, 'penyok', 8.1, 'Ton', 'STEEL COIL', 'SPCC', '0.8x1250', 1, NULL, '-', '2026-01-12 11:00:00'),
 (3, 'c-2', NULL, 101, 250, 1, '', NULL, 0, '-', 0, NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL),
 (4, '-', '40 F', 102, 18909, 5, 'Package', 'Tons', NULL, NULL, 18909, 'Tons', 'PARTS', NULL, NULL, 2, NULL, NULL, NULL),
 (5, 'X-5', '20 F', 999, 1, 1, 'COIL', 'Kg', 0, NULL, 1, 'Kg', 'TANPA JO', NULL, NULL, 0, NULL, NULL, NULL),
 (6, 'Test', '20 F', 101, 1, 1, 'COIL', 'Kg', 0, NULL, 1, 'Kg', 'Material bagus', NULL, NULL, 0, NULL, NULL, NULL),
 (7, 'WING BOX', '1', 102, 100, 3, 'Pieces', 'Kg', 0, NULL, 90, 'Kg', 'WING BOX', NULL, NULL, 0, NULL, NULL, NULL),
 (8, 'Z-8', '45 F', 102, 5, 4, 'BDL', 'Kg', 0, NULL, 4.5, 'Kg', 'BUNDLE', NULL, NULL, 3, NULL, NULL, NULL);
INSERT INTO surat_jalan VALUES
 (1, '2026010001', '2026-01-12', 'BUDI', 'B 1234 XY', 'CIKARANG', '0812', 1, 1, 'GUDANG A', 2, '2026-01-12 09:00:00', '2026-01-12 12:30:00'),
 (2, '2026010001', '2026-01-13', 'ANDI', 'B 9 Z', 'BEKASI', '.', 99, 0, 'GUDANG B', 2, '2026-01-13 09:00:00', NULL),
 (3, '2026010003', '2026-01-14', 'SUPIR', 'B 7', 'TEST', '', 1, 0, '', 2, '2026-01-14 09:00:00', NULL),
 (4, '2026020001', '2026-02-01', 'DEDI', 'B 8 AB', 'JAKARTA', '081', 1, 0, 'GUDANG', 2, '2026-02-01 09:00:00', NULL),
 (5, '2026010005', '2026-01-15', 'EKO', 'B 5 CD', 'DEPOK', '082', 1, 0, 'GUDANG', 2, '2026-01-15 09:00:00', NULL);
INSERT INTO surat_jalan_detil VALUES (1, 1, 1, 1, 101, 1), (2, 1, 2, 2, 101, 1), (3, 1, 3, 1, 101, 0), (4, 2, 4, 2, 102, 1), (5, 4, 12345, 1, 101, 1), (6, 5, 7, 1, 102, 1), (7, 5, 6, 1, 101, 1);
