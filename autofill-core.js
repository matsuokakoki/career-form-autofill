(function initCareerAutofillCore(globalScope) {
  if (globalScope.CareerAutofillCore) return;

  const DEFINITIONS = [
    { key: "facultyDepartment", label: "学部・学科", patterns: ["学部学科", "facultyanddepartment"], exact: ["学部学科", "学部学科名"] },
    { key: "cityStreet", label: "市区町村＋町名・番地", patterns: ["市区郡番地", "市区町村番地", "市町村番地", "市区町村町名番地"] },
    { key: "age", label: "満年齢", patterns: ["年齢", "満年齢", "現在の年齢"], exact: ["年齢", "age"] },
    { key: "occupation", label: "職業", patterns: ["職業", "occupation"], exact: ["職業", "occupation"] },
    { key: "emailConfirm", label: "メールアドレス（確認）", patterns: ["メールアドレス確認", "メール確認", "確認用メール", "メール再入力", "メールアドレス再入力", "メールアドレス再確認", "同じメールアドレス", "emailconfirmation", "confirmemail", "retypeemail", "emailverify"], exact: ["メールアドレス（確認）", "メールアドレス確認"] },
    { key: "email2", label: "メールアドレス2", patterns: ["メールアドレス2", "第二メール", "第2メール", "予備メール", "サブメール", "連絡用メール", "pcメール", "携帯メール", "email2", "mail2", "secondaryemail", "alternateemail"], exact: ["メールアドレス2", "第2メールアドレス"] },
    { key: "email", label: "メールアドレス", patterns: ["メールアドレス", "メール", "e-mail", "email", "mailaddress", "mail"], autocomplete: ["email"], inputTypes: ["email"], negative: ["確認", "confirm", "再入力", "再確認", "2", "第二", "予備", "サブ"] },
    { key: "lastNameKana", label: "姓（全角カナ）", patterns: ["セイ", "姓カナ", "姓フリガナ", "姓ふりがな", "姓ヨミ", "姓読み", "lastnam-kana", "familyname-kana", "familynamekana"], exact: ["セイ", "姓（カナ）", "姓（フリガナ）"] },
    { key: "firstNameKana", label: "名（全角カナ）", patterns: ["メイ", "名カナ", "名フリガナ", "名ふりがな", "名ヨミ", "名読み", "firstname-kana", "givenname-kana", "givennamekana"], exact: ["メイ", "名（カナ）", "名（フリガナ）"] },
    { key: "fullNameKana", label: "氏名（全角カナ）", patterns: ["氏名カナ", "氏名フリガナ", "氏名ふりがな", "お名前カナ", "おなまえカナ", "フリガナ", "ふりがな", "ヨミガナ", "よみがな", "カナ氏名", "kanafullname"], exact: ["フリガナ", "ふりがな", "氏名（カナ）"] },
    { key: "lastNameHalfKana", label: "姓（半角カナ）", patterns: ["セイ半角", "姓半角カナ", "lastkana-half"], exact: ["セイ（半角）", "姓（半角カナ）"] },
    { key: "firstNameHalfKana", label: "名（半角カナ）", patterns: ["メイ半角", "名半角カナ", "firstkana-half"], exact: ["メイ（半角）", "名（半角カナ）"] },
    { key: "fullNameHalfKana", label: "氏名（半角カナ）", patterns: ["氏名半角カナ", "フリガナ半角", "半角カナ氏名"], exact: ["フリガナ（半角）", "氏名（半角カナ）"] },
    { key: "lastNameKanji", label: "姓（漢字）", patterns: ["氏名姓", "お名前姓", "苗字", "名字", "姓氏", "lastname", "familyname", "surname"], exact: ["姓", "姓（漢字）"], autocomplete: ["family-name"] },
    { key: "firstNameKanji", label: "名（漢字）", patterns: ["氏名名", "お名前名", "下の名前", "givenname", "firstname", "forename"], exact: ["名", "名（漢字）"], autocomplete: ["given-name"] },
    { key: "fullNameKanji", label: "氏名（漢字）", patterns: ["氏名", "お名前", "氏名漢字", "申込者名", "応募者名", "本人氏名", "受験者名", "fullname", "yourname", "applicantname"], exact: ["氏名", "お名前", "名前"], autocomplete: ["name"], negative: ["保護者", "親", "カナ", "かな", "フリガナ", "ふりがな", "ヨミ"] },

    { key: "phone", label: "電話番号", patterns: ["携帯電話", "携帯番号", "携帯の番号", "電話番号", "電話", "連絡先電話", "緊急連絡先", "mobilephone", "phonenumber", "telephone", "tel", "mobile"], autocomplete: ["tel", "tel-national"], inputTypes: ["tel"] },
    { key: "postalCode", label: "郵便番号", patterns: ["郵便番号", "郵便", "postalcode", "postcode", "zipcode", "zip"], autocomplete: ["postal-code"] },
    { key: "prefecture", label: "都道府県", patterns: ["都道府県", "都道府県名", "prefecture", "addresslevel1", "province", "state"], autocomplete: ["address-level1"] },
    { key: "city", label: "市区町村", patterns: ["市区町村", "市町村", "区市町村", "市郡", "自治体", "municipality", "addresslevel2", "city", "ward"], autocomplete: ["address-level2"] },
    { key: "addressLine2", label: "建物名・部屋番号", patterns: ["建物名", "マンション名", "アパート名", "部屋番号", "号室", "住所2", "住所第二", "addressline2", "building", "apartment", "unit"], autocomplete: ["address-line2"] },
    { key: "addressLine1", label: "町名・番地", patterns: ["町名番地", "町域番地", "町名", "番地", "住所1", "住所第一", "addressline1", "streetaddress", "street"], autocomplete: ["address-line1"], negative: ["建物", "マンション", "アパート", "部屋", "号室"] },
    { key: "fullAddress", label: "住所", patterns: ["現住所", "自宅住所", "居住地", "住所", "fulladdress", "homeaddress", "residentialaddress"], exact: ["住所", "現住所"], autocomplete: ["street-address"], negative: ["郵便", "都道府県", "市区町村", "建物", "番地", "町名", "部屋"] },

    { key: "birthYear", label: "生年", patterns: ["生年月日年", "生年", "birthyear", "birthdayyear", "dobyear"], exact: ["年（生年月日）"] },
    { key: "birthMonth", label: "誕生月", patterns: ["生年月日月", "誕生月", "birthmonth", "birthdaymonth", "dobmonth"], exact: ["月（生年月日）"] },
    { key: "birthDay", label: "誕生日（日）", patterns: ["生年月日日", "生年月日の日", "誕生日日", "birthdayday", "dobday"], exact: ["日（生年月日）"] },
    { key: "birthDate", label: "生年月日", patterns: ["生年月日", "誕生日", "出生年月日", "dateofbirth", "birthday", "birthdate", "dob"], autocomplete: ["bday"], inputTypes: ["date"] },
    { key: "gender", label: "性別", patterns: ["性別", "ジェンダー", "gender", "sex"] },

    { key: "parentName", label: "保護者氏名", patterns: ["保護者氏名", "保護者名", "親権者氏名", "父母氏名", "guardianname", "parentname"] },
    { key: "relationship", label: "本人との続柄", patterns: ["本人との続柄", "あなたとの関係", "保護者続柄", "relationship", "relation"] },

    { key: "university", label: "大学名", patterns: ["在籍大学", "所属大学", "出身大学", "学校名", "大学名", "大学校名", "university", "collegename", "schoolname", "institution"], exact: ["大学", "大学名"] },
    { key: "universityType", label: "大学区分", patterns: ["国立私立", "国立大学私立大学", "国公立", "大学区分", "設置区分", "設置者", "大学種別", "schooltype", "institutiontype"] },
    { key: "universityInitial", label: "大学名の頭文字", patterns: ["大学名頭文字", "大学頭文字", "学校名頭文字", "大学名最初の文字", "最初の文字", "初めの文字", "頭文字", "initialletter", "initial"] },
    { key: "faculty", label: "学部", patterns: ["所属学部", "学部名", "faculty"], exact: ["学部"] },
    { key: "department", label: "学科・専攻", patterns: ["学科専攻", "所属学科", "学科名", "専攻名", "department", "major"], exact: ["学科", "専攻"] },
    { key: "enrollmentYear", label: "入学年", patterns: ["入学年月年", "入学年", "enrollmentyear", "admissionyear", "entranceyear"] },
    { key: "enrollmentMonth", label: "入学月", patterns: ["入学年月月", "入学月", "enrollmentmonth", "admissionmonth", "entrancemonth"] },
    { key: "graduationYear", label: "卒業（予定）年", patterns: ["卒業予定年月年", "卒業年月年", "卒業予定年", "卒業年", "graduationyear"] },
    { key: "graduationMonth", label: "卒業（予定）月", patterns: ["卒業予定年月月", "卒業年月月", "卒業予定月", "卒業月", "graduationmonth"] }
  ];

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\u3000・･_\-—–:：/\\()（）\[\]【】「」『』.,，。]/g, "");
  }

  function compact(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function toHalfWidthKana(value) {
    const full = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー。「」、・ヵヶヴガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ";
    const half = ["ｱ","ｲ","ｳ","ｴ","ｵ","ｶ","ｷ","ｸ","ｹ","ｺ","ｻ","ｼ","ｽ","ｾ","ｿ","ﾀ","ﾁ","ﾂ","ﾃ","ﾄ","ﾅ","ﾆ","ﾇ","ﾈ","ﾉ","ﾊ","ﾋ","ﾌ","ﾍ","ﾎ","ﾏ","ﾐ","ﾑ","ﾒ","ﾓ","ﾔ","ﾕ","ﾖ","ﾗ","ﾘ","ﾙ","ﾚ","ﾛ","ﾜ","ｦ","ﾝ","ｧ","ｨ","ｩ","ｪ","ｫ","ｯ","ｬ","ｭ","ｮ","ｰ","｡","｢","｣","､","･","ｶ","ｹ","ｳﾞ","ｶﾞ","ｷﾞ","ｸﾞ","ｹﾞ","ｺﾞ","ｻﾞ","ｼﾞ","ｽﾞ","ｾﾞ","ｿﾞ","ﾀﾞ","ﾁﾞ","ﾂﾞ","ﾃﾞ","ﾄﾞ","ﾊﾞ","ﾋﾞ","ﾌﾞ","ﾍﾞ","ﾎﾞ","ﾊﾟ","ﾋﾟ","ﾌﾟ","ﾍﾟ","ﾎﾟ"];
    const map = new Map(Array.from(full).map((char, index) => [char, half[index]]));
    return Array.from(String(value ?? "").normalize("NFKC"), (char) => map.get(char) ?? char).join("");
  }

  function digits(value) {
    return String(value ?? "").normalize("NFKC").replace(/\D/g, "");
  }

  function splitPhone(value) {
    const original = compact(value);
    const explicit = original.split(/[-ー−\s]/).filter(Boolean);
    if (explicit.length >= 2) return explicit;
    const raw = digits(original);
    if (raw.length === 11) return [raw.slice(0, 3), raw.slice(3, 7), raw.slice(7)];
    if (raw.length === 10) return [raw.slice(0, 3), raw.slice(3, 6), raw.slice(6)];
    return [raw];
  }

  function splitPostal(value) {
    const original = compact(value);
    const explicit = original.split(/[-ー−\s]/).filter(Boolean);
    if (explicit.length === 2) return explicit;
    const raw = digits(original);
    return raw.length === 7 ? [raw.slice(0, 3), raw.slice(3)] : [raw];
  }

  function prepareProfile(rawProfile = {}, language = "ja") {
    const p = {};
    for (const [key, value] of Object.entries(rawProfile)) p[key] = compact(value);

    // Keep semantic field keys stable.  English mode merely overlays the
    // values used for those keys, so the same matching and safe form-writing
    // path is used for both languages.
    if (language === "en") {
      p.lastNameKanji = p.lastNameLatin || "";
      p.firstNameKanji = p.firstNameLatin || "";
      p.fullNameKanji = p.fullNameLatin || "";
      p.lastNameKana = "";
      p.firstNameKana = "";
      p.fullNameKana = "";
      p.lastNameHalfKana = "";
      p.firstNameHalfKana = "";
      p.fullNameHalfKana = "";
      p.prefecture = p.stateProvince || "";
      p.city = p.cityEnglish || "";
      p.addressLine1 = p.addressLine1English || "";
      p.addressLine2 = p.addressLine2English || "";
      p.fullAddress = p.fullAddressEnglish || "";
      p.university = p.universityEnglish || "";
      p.faculty = p.facultyEnglish || "";
      p.department = p.departmentEnglish || "";
    }

    p.fullNameKanji = compact(p.fullNameKanji || [p.lastNameKanji, p.firstNameKanji].filter(Boolean).join(" "));
    p.fullNameKana = compact(p.fullNameKana || [p.lastNameKana, p.firstNameKana].filter(Boolean).join(" "));
    p.lastNameHalfKana = p.lastNameHalfKana || toHalfWidthKana(p.lastNameKana);
    p.firstNameHalfKana = p.firstNameHalfKana || toHalfWidthKana(p.firstNameKana);
    p.fullNameHalfKana = compact(p.fullNameHalfKana || [p.lastNameHalfKana, p.firstNameHalfKana].filter(Boolean).join(" "));
    p.fullAddress = compact(p.fullAddress || [p.prefecture, p.city, p.addressLine1, p.addressLine2].filter(Boolean).join(language === "en" ? ", " : ""));
    p.facultyDepartment = [p.faculty, p.department].filter(Boolean).join(language === "en" ? ", " : " ");
    p.cityStreet = p.city && p.addressLine1 ? [p.city, p.addressLine1].join(language === "en" ? ", " : "") : "";
    p.emailConfirm = p.email;
    if (!p.universityType && /名古屋大学/.test(p.university)) p.universityType = "国立";
    if (!p.universityInitial && /名古屋大学/.test(p.university)) p.universityInitial = "な";

    const year = digits(p.birthYear);
    const month = digits(p.birthMonth);
    const day = digits(p.birthDay);
    p.birthDate = p.birthDate || (year && month && day ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "");
    p.age = "";
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.birthDate);
    if (iso) {
      const [, y, m, d] = iso.map(Number);
      const birth = new Date(y, m - 1, d);
      const today = new Date();
      if (birth <= today && birth.getFullYear() === y && birth.getMonth() + 1 === m && birth.getDate() === d) {
        const beforeBirthday = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
        p.age = String(today.getFullYear() - y - Number(beforeBirthday));
      }
    }
    p.phoneDigits = digits(p.phone);
    p.phoneParts = splitPhone(p.phone);
    p.postalDigits = digits(p.postalCode);
    p.postalParts = splitPostal(p.postalCode);
    return p;
  }

  function definitionValue(definition, profile) {
    if (definition.key === "phone") return profile.phone;
    if (definition.key === "postalCode") return profile.postalCode;
    return profile[definition.key] ?? "";
  }

  function includesAny(haystack, needles = []) {
    return needles.some((needle) => haystack.includes(normalize(needle)));
  }

  function autocompleteTokens(value) {
    return String(value ?? "").toLowerCase().split(/\s+/).map(normalize).filter(Boolean);
  }

  function compatibleField(key, signals) {
    const semantic = normalize(signals.label || signals.nearby);
    const splitLabel = {
      氏名姓: "lastNameKanji", 氏名名: "firstNameKanji", セイ: "lastNameKana", メイ: "firstNameKana",
      姓半角カナ: "lastNameHalfKana", 名半角カナ: "firstNameHalfKana",
      生年月日年: "birthYear", 生年月日月: "birthMonth", 生年月日日: "birthDay"
    }[normalize(signals.label)];
    if (splitLabel) return key === splitLabel;
    if (/年齢|^age(?:required|\*)?$/.test(semantic)) {
      return key === "age" && !/時点|現在ではなく|年\d|基準日|asof|ondate/.test(semantic);
    }
    if (/^(職業|occupation)(必須|required|\*|$)/.test(semantic)) return key === "occupation";
    if (/マンション|アパート|建物名|部屋番号|apartment/.test(normalize(signals.label))) return key === "addressLine2";
    if (/市区郡番地|市区町村番地|市町村番地|市区町村町名番地/.test(normalize(signals.label))) return key === "cityStreet";
    const telephone = /電話|携帯番号|携帯の番号|携帯電話|mobilephone|mobilenumber|phonenumber|telephone/.test(semantic);
    return !telephone || key === "phone";
  }

  function scoreDefinition(definition, signals) {
    if (!compatibleField(definition.key, signals)) return { score: 0, reasons: ["電話番号欄と矛盾"] };
    const label = normalize(signals.label);
    const attrs = normalize(signals.attrs);
    const nearby = normalize(signals.nearby);
    const autocomplete = normalize(signals.autocomplete);
    const autocompleteValues = autocompleteTokens(signals.autocomplete);
    const inputType = normalize(signals.inputType);
    const patterns = (definition.patterns || []).map(normalize);
    const exact = (definition.exact || []).map(normalize);

    let score = 0;
    const reasons = [];

    if ((definition.autocomplete || []).map(normalize).some((value) => autocompleteValues.includes(value)) && autocomplete) {
      score = 100;
      reasons.push("autocomplete属性が一致");
    }
    if ((definition.inputTypes || []).map(normalize).includes(inputType) && inputType) {
      score = Math.max(score, 68);
      reasons.push("入力タイプが一致");
    }
    if (exact.includes(label) && label) {
      score = Math.max(score, 94);
      reasons.push("ラベルが完全一致");
    }

    const labelMatches = patterns.filter((pattern) => pattern && label.includes(pattern));
    const attrMatches = patterns.filter((pattern) => pattern && attrs.includes(pattern));
    const nearbyMatches = patterns.filter((pattern) => pattern && nearby.includes(pattern));

    if (labelMatches.length) {
      const specificity = Math.min(18, Math.max(...labelMatches.map((item) => item.length * 2)));
      score = Math.max(score, 64 + specificity);
      reasons.push("ラベルの語句が一致");
    }
    if (attrMatches.length) {
      const specificity = Math.min(15, Math.max(...attrMatches.map((item) => item.length * 2)));
      score = Math.max(score, 52 + specificity);
      reasons.push("name/id等が一致");
    }
    if (nearbyMatches.length) {
      const specificity = Math.min(12, Math.max(...nearbyMatches.map((item) => item.length)));
      score = Math.max(score, 58 + specificity);
      reasons.push("周辺テキストが一致");
    }

    // Nearby text often contains neighbouring questions (for example both
    // "氏名" and "フリガナ"). Use it as positive evidence, but do not let a
    // neighbour's exclusion word suppress an otherwise explicit label.
    const combined = `${label} ${attrs}`;
    if (includesAny(combined, definition.negative)) {
      score -= 45;
      reasons.push("除外語を検出");
    }

    // A strong HTML attribute (for example name="tel") must not override an
    // explicit question label that clearly describes another field.
    const semanticText = label || nearby;
    const addressKeys = new Set(["postalCode", "prefecture", "city", "cityStreet", "addressLine1", "addressLine2", "fullAddress"]);
    const addressWords = ["住所", "郵便", "都道府県", "市区町村", "町名", "番地", "建物", "マンション", "部屋", "居住地"];
    const educationSubfieldWords = ["学部", "学科", "専攻"];
    if (!addressKeys.has(definition.key) && includesAny(semanticText, addressWords)) {
      score -= 70;
      reasons.push("住所欄の文脈と矛盾");
    }
    if (definition.key === "university" && includesAny(label, educationSubfieldWords)) {
      score -= 70;
      reasons.push("学部・学科欄と矛盾");
    }
    if (definition.key === "faculty" && includesAny(label, ["学科", "専攻"])) {
      score -= 15;
      reasons.push("学科・専攻の語を検出");
    }
    if (definition.key === "department" && includesAny(label, ["学部学科", "学部・学科"])) {
      score = Math.max(score, 78);
      reasons.push("学部・学科の複合ラベル");
    }

    return { score: Math.max(0, Math.min(100, score)), reasons };
  }

  function matchField(signals, rawProfile, minimumScore = 48, language = "ja") {
    const profile = prepareProfile(rawProfile, language);
    let best = null;
    for (const definition of DEFINITIONS) {
      const value = definitionValue(definition, profile);
      if (!value) continue;
      const result = scoreDefinition(definition, signals);
      if (!best || result.score > best.score) {
        best = { ...definition, value, score: result.score, reasons: result.reasons };
      }
    }
    return best && best.score >= minimumScore ? best : null;
  }

  function definitionForKey(key) {
    return DEFINITIONS.find((definition) => definition.key === key) || null;
  }

  function fieldValue(key, rawProfile) {
    const definition = definitionForKey(key);
    return definition ? definitionValue(definition, prepareProfile(rawProfile)) : "";
  }

  function confidence(score) {
    if (score >= 82) return { key: "high", label: "高" };
    if (score >= 60) return { key: "medium", label: "中" };
    return { key: "low", label: "要確認" };
  }

  const api = {
    DEFINITIONS,
    normalize,
    toHalfWidthKana,
    digits,
    splitPhone,
    splitPostal,
    prepareProfile,
    autocompleteTokens,
    scoreDefinition,
    compatibleField,
    matchField,
    definitionForKey,
    fieldValue,
    confidence
  };

  globalScope.CareerAutofillCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
