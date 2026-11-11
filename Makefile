.PHONY: debug phoneinstall

# Preview on this Mac. Open http://127.0.0.1:4173/?debug=1
debug:
	node scripts/debug-server.mjs

# Build with Xcode and install it on the iPhone connected by USB.
phoneinstall:
	python3 scripts/phone-install.py
