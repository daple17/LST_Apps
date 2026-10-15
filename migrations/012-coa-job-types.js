// COA: type Job Order tempat akun berlaku (Import/Export/Trucking/Project; boleh lebih dari satu). Kosong = semua type. Akun yang sudah ada tetap kosong.
exports.up = async m => { await m.addCol('coa_accounts', 'job_types', "SET('IMPORT','EXPORT','TRUCKING','PROJECT') NOT NULL DEFAULT ''"); };
