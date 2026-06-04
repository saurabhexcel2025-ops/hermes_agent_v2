# CPU Load API (demo trigger)

A tiny HTTP service that runs **on the target** (`space-armour-server`) so you can
spike its CPU with an HTTP call and watch Sentinel detect/log it on the
`/sentinel` Ops page — no SSH needed.

## Where it runs
- Host: `space-armour-server` (external `35.253.182.184`), port **8099**.
- systemd service `cpu-load-api` (`/opt/cpu-load-api/load_api.py`), runs on boot.
- GCP firewall rule `allow-cpu-load-api` (tcp:8099) + instance tag `cpu-load-api`.
- Protected by a shared token in `SPIKE_TOKEN` (systemd env). Hits without the
  correct `?token=` get 401.

## Use
```bash
# spike 2 workers for 30s (max CPU on the 2-vCPU box)
curl "http://35.253.182.184:8099/spike?token=<TOKEN>&seconds=30&workers=2"

curl "http://35.253.182.184:8099/status?token=<TOKEN>"   # running workers
curl "http://35.253.182.184:8099/stop?token=<TOKEN>"     # stop early
```
`seconds` 1..300 (def 30), `workers` 1..2×ncpu (def ncpu). Each worker is a
`timeout N sha1sum /dev/zero` burn that self-terminates.

## Operate
```bash
sudo systemctl status cpu-load-api
sudo systemctl restart cpu-load-api
# token lives in the unit:
grep SPIKE_TOKEN /etc/systemd/system/cpu-load-api.service
```

## Security note
The firewall opens 8099 to `0.0.0.0/0`; the token is the only gate. To lock it
down, restrict the rule's `--source-ranges` to your IP, or delete the rule when
not demoing:
```bash
gcloud compute firewall-rules delete allow-cpu-load-api --project mission-control-497604
```
