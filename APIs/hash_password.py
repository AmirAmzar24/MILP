"""
Generate a PBKDF2 password hash for use in the .env file.

Usage:
    python APIs/hash_password.py 'your-password'

Copy the printed hash into AUTH_PASSWORD_HASH (single-user) or into the
AUTH_USERS JSON map (multi-user). Never store plaintext passwords.
"""

import sys

from auth import hash_password


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python APIs/hash_password.py 'your-password'")
        return 1
    print(hash_password(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
