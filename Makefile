.PHONY: setup backend frontend test e2e stop clean
VENV := .venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

setup: $(VENV)/bin/activate
$(VENV)/bin/activate:
	uv venv $(VENV) --seed
	$(PIP) install -r backend/requirements.txt

backend:
	$(PY) -m uvicorn app.main:app --port 8000 --app-dir backend

frontend:
	cd frontend && npm install && npm run dev -- --port 5173

test:
	$(PY) -m pytest backend/tests/ -q

e2e:
	cd e2e && npm install && npx playwright test -c smoke.config.ts --project=chromium

stop:
	for p in $$(pgrep -f "uvicorn app\.main"); do kill $$p; done; true
	pkill -f "vite --port 5173" 2>/dev/null; true
	@echo "stopped (if a 'port already in use' persists, run: ss -ltnp | grep -E '8000|5173')"

clean:
	rm -rf $(VENV) frontend/dist frontend/node_modules e2e/node_modules
