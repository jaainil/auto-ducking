# VPS deployment

GitHub builds the existing Dockerfile and publishes to
`ghcr.io/jaainil/auto-ducking`. The VPS only downloads and starts the image.
BuildKit reuses build layers between runs. Images include FFmpeg and ffprobe.
The default build targets an x86-64 VPS (linux/amd64).

## One-time setup

1. Install Docker Engine and the Docker Compose plugin on the VPS.
2. Create an SSH deployment user that can run Docker without sudo. Docker access
   grants root-equivalent access; use a dedicated key for this repository.
3. Create `/opt/autoduck` and give that user ownership:

   ```sh
   sudo mkdir -p /opt/autoduck
   sudo chown YOUR_DEPLOY_USER:YOUR_DEPLOY_USER /opt/autoduck
   ```

4. Add the deployment public key to that user's `~/.ssh/authorized_keys`.
5. In GitHub repository Settings → Secrets and variables → Actions, add:

   | Secret | Value |
   | --- | --- |
   | `VPS_HOST` | VPS IP address or SSH hostname |
   | `VPS_USER` | Deployment username |
   | `VPS_SSH_KEY` | Dedicated SSH private key |
   | `VPS_KNOWN_HOSTS` | Verified SSH host-key entry for your VPS |
   | `VPS_PORT` | Optional SSH port; defaults to 22 |

   Obtain the host-key entry with `ssh-keyscan -p 22 YOUR_VPS_HOST` and compare
   its fingerprint with the VPS console before saving it. For custom SSH ports,
   use that port in both the command and the secret.

6. Push the workflow to `main`. The first run builds and publishes only.
   GHCR packages initially may be private. Either make this package public in
   GitHub's package settings, or log in **as the deployment user on the VPS**:

   ```sh
   docker login ghcr.io -u YOUR_GITHUB_USERNAME
   ```

   For a private package, enter a classic GitHub PAT with `read:packages` access
   at the password prompt. Do not put the token in the repository.

7. Set the GitHub Actions **variable** `VPS_DEPLOY_ENABLED` to `true`.
   Run **Build and deploy** manually from the Actions tab, or push to `main`.

The workflow publishes a commit tag and deploys its exact digest. Deployment
downloads the image before replacing the container, and waits for HTTP health
plus actual FFmpeg and ffprobe checks. A failed health check fails the workflow;
it does not automatically roll back. Container replacement causes brief downtime.

## Domain and data

Point your existing Nginx/Caddy proxy for `autoduck.altctrlai.com` to
`http://127.0.0.1:10000`. Docker exposes this port only on the VPS loopback interface.
Keep TLS configured on your reverse proxy.

Uploads and project files live in the persistent `autoduck-data` Docker volume.
Back up this volume. Do not run `docker compose down -v`.

If you already have a container named `autoduck` using port 10000, stop it before
the first Compose deployment. If your existing app uses another data directory,
copy its contents into the volume before switching; deployment does not migrate
existing files automatically.

## Logs and rollback

On the VPS:

```sh
docker compose -p autoduck -f /opt/autoduck/compose.yaml logs --tail=100 app
cat /opt/autoduck/current-image.txt
```

To roll back, use the digest from a previous successful workflow's build output:

```sh
bash /opt/autoduck/deploy.sh ghcr.io/jaainil/auto-ducking@sha256:PREVIOUS_DIGEST
```

`current-image.txt` records the last deployment that passed its health check.
