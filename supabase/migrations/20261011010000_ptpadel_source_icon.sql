-- Apply after deploying public/source-icons/ptpadel-portugal.png.
-- The adapter writes the same URL on future hourly imports.
UPDATE articles
SET favicon_url = 'https://padelnachos.com/source-icons/ptpadel-portugal.png',
    source_icon = 'https://padelnachos.com/source-icons/ptpadel-portugal.png'
WHERE source_key = 'ptpadelportugal';
