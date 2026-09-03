import os


workers = int(os.environ.get('GUNICORN_PROCESSES', '2'))

threads = int(os.environ.get('GUNICORN_THREADS', '4'))

timeout = int(os.environ.get('GUNICORN_TIMEOUT', '30'))

# systemd creates /run/come-see (RuntimeDirectory=come-see); nginx connects to the socket
bind = os.environ.get('GUNICORN_BIND', 'unix:/run/come-see/gunicorn.sock')

# socket is created group-readable/writable (deploy:www-data) so nginx can reach it
umask = 0o007


forwarded_allow_ips = '*'

secure_scheme_headers = { 'X-Forwarded-Proto': 'https' }
