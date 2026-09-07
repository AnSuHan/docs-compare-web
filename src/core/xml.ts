/**
 * DOM 없는 XML 스캐너.
 *
 * 파서는 워커 안에서 돈다. 워커에는 DOMParser 가 없다 — 기획서 §7.3 / §8.3 의
 * DOMParser 예시를 그대로 쓰면 배포에서 죽는다. core 를 Node 에서 테스트해야
 * 한다는 규칙(§11)과도 어긋난다.
 *
 * 우리에게 필요한 건 "문서 순서대로 여는 태그·닫는 태그·텍스트를 훑는 것"뿐이다.
 * 트리를 만들지 않으므로 메모리도 적게 든다.
 */

export interface XmlOpen {
  kind: 'open';
  /** 네임스페이스 접두사를 뗀 이름. `hp:t` → `t` */
  name: string;
  /** 원본 이름 그대로. `hp:t` */
  qname: string;
  attrs: Record<string, string>;
  /** `<br/>` 처럼 스스로 닫는 태그 */
  selfClosing: boolean;
}

export interface XmlClose {
  kind: 'close';
  name: string;
  qname: string;
}

export interface XmlText {
  kind: 'text';
  /** 엔티티가 풀린 텍스트 */
  text: string;
}

export type XmlEvent = XmlOpen | XmlClose | XmlText;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
}

/** `a="1" b='2' c=3` 을 훑는다. XML 은 따옴표가 필수지만 관대하게 받는다. */
function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/**
 * XML 을 문서 순서대로 훑는다.
 * 주석·CDATA·처리 명령·DOCTYPE 을 건너뛴다. 잘린 문서에서도 멈추지 않는다.
 */
export function* scanXml(xml: string): Generator<XmlEvent> {
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      const rest = xml.slice(i);
      if (rest) yield { kind: 'text', text: decodeEntities(rest) };
      return;
    }
    if (lt > i) {
      yield { kind: 'text', text: decodeEntities(xml.slice(i, lt)) };
    }

    // <!-- 주석 -->, <![CDATA[...]]>, <!DOCTYPE ...>
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const body = xml.slice(lt + 9, end < 0 ? n : end);
      if (body) yield { kind: 'text', text: body };
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt) || xml.startsWith('<?', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) return; // 잘린 문서
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (inner[0] === '/') {
      const qname = inner.slice(1).trim();
      yield { kind: 'close', name: localName(qname), qname };
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s/]/);
    const qname = (sp < 0 ? body : body.slice(0, sp)).trim();
    if (!qname) continue;

    yield {
      kind: 'open',
      name: localName(qname),
      qname,
      attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)),
      selfClosing,
    };
  }
}

/** 루트 요소의 속성만 필요할 때. 예: header.xml 의 secCnt */
export function rootAttrs(xml: string): Record<string, string> {
  for (const ev of scanXml(xml)) {
    if (ev.kind === 'open') return ev.attrs;
  }
  return {};
}
