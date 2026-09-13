"""LAN内のスマートフォンからもアクセスできるようにするための準備スクリプト。

行うこと:
  1. このPCのLAN内IPアドレスを検出する
  2. ブラウザのマイクAPI(getUserMedia)はHTTPS（またはlocalhost）でないと動作しないため、
     このIPアドレス向けの自己署名TLS証明書を毎回生成する（certs/cert.pem, certs/key.pem）
  3. PC・スマホそれぞれで開くべきURLと、スマホ用のQRコードを表示する

外部のCA局には一切問い合わせない（すべてこのPC上で完結する自己署名証明書）。
"""
from __future__ import annotations

import datetime
import ipaddress
import socket
from pathlib import Path

CERTS_DIR = Path(__file__).parent / "certs"
CERT_PATH = CERTS_DIR / "cert.pem"
KEY_PATH = CERTS_DIR / "key.pem"


def get_lan_ip() -> str:
    """このPCのLAN内IPアドレスを推定する（実際には通信を送信しない）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def generate_self_signed_cert(lan_ip: str) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    CERTS_DIR.mkdir(exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "medical-ai-local")])

    san_entries = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    try:
        san_entries.append(x509.IPAddress(ipaddress.ip_address(lan_ip)))
    except ValueError:
        pass

    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .sign(key, hashes.SHA256())
    )

    KEY_PATH.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    CERT_PATH.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def print_qr(url: str) -> None:
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make()
        qr.print_ascii(invert=True)
    except Exception as e:  # noqa: BLE001
        print(f"（QRコードの表示に失敗しました: {e}。URLを直接入力してください）")


def main() -> None:
    lan_ip = get_lan_ip()
    port = 8443

    # 起動のたびに再生成する（前回と別のWi-Fiに繋いでIPが変わっていても常に正しい証明書にするため）。
    generate_self_signed_cert(lan_ip)

    pc_url = f"https://localhost:{port}"
    lan_url = f"https://{lan_ip}:{port}"

    print("==================================================")
    print(" ネットワーク設定が完了しました")
    print("==================================================")
    print("")
    print(f" [PCから] {pc_url}")
    print(f" [同じWi-FiのスマホやPCから] {lan_url}")
    print("")
    print(" ↓ スマホのカメラでこのQRコードを読み取るとアクセスできます")
    print("")
    print_qr(lan_url)
    print("")
    print(" 初回アクセス時、自己署名証明書のため「保護されていない通信」")
    print(" 「この接続ではプライバシーが保護されません」等の警告が表示されます。")
    print(" 「詳細設定」→「(IPアドレス)にアクセスする（安全ではありません）」を選ぶと")
    print(" 進めます（README.md の手順もあわせて参照してください）。")
    print("==================================================")


if __name__ == "__main__":
    main()
