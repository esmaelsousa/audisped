#!/bin/bash
# Backup automático do banco audisped_db → Google Drive
# Mantém os últimos 30 dias

BACKUP_DIR="/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/backups_db"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="audisped_db"
PGPASSWORD="@820439"

mkdir -p "$BACKUP_DIR"

FILENAME="audisped_db_$(date +%Y-%m-%d_%H%M).sql.gz"
FILEPATH="$BACKUP_DIR/$FILENAME"

export PGPASSWORD
/Library/PostgreSQL/16/bin/pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" | gzip > "$FILEPATH"

if [ $? -eq 0 ]; then
    echo "[$(date)] Backup criado: $FILENAME ($(du -sh "$FILEPATH" | cut -f1))"
else
    echo "[$(date)] ERRO ao criar backup!" >&2
    exit 1
fi

# Remove backups com mais de 30 dias
find "$BACKUP_DIR" -name "audisped_db_*.sql.gz" -mtime +30 -delete
echo "[$(date)] Limpeza de backups antigos concluída."
