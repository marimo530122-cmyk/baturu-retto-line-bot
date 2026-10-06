"""現場からのローカルルール追記の仕組み(app/custom_instructions.py)の回帰テスト。"""
import importlib


def test_prompts_unchanged_when_custom_instructions_empty():
    import app.custom_instructions as custom_instructions

    assert custom_instructions.CUSTOM_CLINICAL_INSTRUCTIONS == ""


def test_with_custom_instructions_noop_when_empty():
    import app.prompts as prompts

    assert "【現場からの追加ルール】" not in prompts.SOAP_SYSTEM_PROMPT


def test_with_custom_instructions_appends_when_set():
    import app.custom_instructions as custom_instructions
    import app.prompts as prompts

    original = custom_instructions.CUSTOM_CLINICAL_INSTRUCTIONS
    custom_instructions.CUSTOM_CLINICAL_INSTRUCTIONS = "当院では薬剤名を商品名で記載すること。"
    try:
        importlib.reload(prompts)
        assert "当院では薬剤名を商品名で記載すること。" in prompts.SOAP_SYSTEM_PROMPT
        assert "【現場からの追加ルール】" in prompts.PRESCRIPTION_SYSTEM_PROMPT
    finally:
        # 元の値に戻してから再読み込みする(戻す前に再読み込みすると汚染した内容のまま
        # 固定されてしまい、他のテストに影響するため順序が重要)
        custom_instructions.CUSTOM_CLINICAL_INSTRUCTIONS = original
        importlib.reload(prompts)
