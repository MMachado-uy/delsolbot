#!/bin/bash
parent_path=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
cd "$parent_path"

envPath='../.env'

_echo() {
    echo ">>> $@"
}

runsql() {
    _echo "Running $1..."

    if [[ -f "$1" ]]; then
        mysql -u "$DB_USER" -p"$DB_PASS" "$DB" < $1 2>&1 | sed 's/^/    /'
        _echo "Done!"
    else
        _echo "No more scripts to feed"
        exit 0
    fi
}

/etc/init.d/mysql status | grep "stopped\|dead"
if [[ $? -eq 0 ]]; then
    _echo "`date` - MySQL not running"
else
    DB=$(grep -w DB ${envPath} | cut -d '=' -f2)
    DB_USER=$(grep -w DB_USER ${envPath} | cut -d '=' -f2)
    DB_PASS=$(grep -w DB_PASS ${envPath} | cut -d '=' -f2)
    DB_PORT=$(grep -w DB_PORT ${envPath} | cut -d '=' -f2)
    DB_HOST=$(grep -w DB_HOST ${envPath} | cut -d '=' -f2)

    mysql -u "$DB_USER" -p"$DB_PASS" -e "CREATE DATABASE IF NOT EXISTS ${DB}; USE ${DB};"

    runsql "schema.sql"

    if [[ "$1" == "--no-seed" ]] ; then
        _echo "No Seed"
    else
        runsql "seed.sql"
    fi

    i=1
    file=$(printf "update_%03d.sql" "$i")

    while [[ -f "$file" ]]
    do
        runsql $file

        let i++
        file=$(printf "update_%03d.sql" "$i")
    done
fi

exit $?
