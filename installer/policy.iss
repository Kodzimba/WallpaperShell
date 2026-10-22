// Shared by the real installer and the inert policy test executable.
function ValidRuntimeVersion(Value: String): Boolean;
var I, Parts, Number: Integer; HasDigit, Nonzero: Boolean;
begin
  Result := False;
  if (Length(Value) < 7) or (Length(Value) > 31) then Exit;
  Parts := 1; Number := 0; HasDigit := False; Nonzero := False;
  for I := 1 to Length(Value) do begin
    if (Value[I] >= '0') and (Value[I] <= '9') then begin
      HasDigit := True; Number := Number * 10 + Ord(Value[I]) - Ord('0');
      if Number > 65535 then Exit;
    end else if Value[I] = '.' then begin
      if not HasDigit then Exit;
      Nonzero := Nonzero or (Number > 0);
      Parts := Parts + 1; if Parts > 4 then Exit;
      Number := 0; HasDigit := False;
    end else Exit;
  end;
  Result := (Parts = 4) and HasDigit and (Nonzero or (Number > 0));
end;

function PrerequisiteSucceeded(Code: Integer): Boolean;
begin
  Result := (Code = 0) or (Code = 3010);
end;

function SameInstallRoot(Candidate, Expected: String): Boolean;
begin
  Result := (Length(Candidate) > 3) and
    (CompareText(AddBackslash(ExpandFileName(Candidate)),
                 AddBackslash(ExpandFileName(Expected))) = 0);
end;

function ReadAppVersion(Text: String): String;
var At, Finish: Integer; Tail: String;
begin
  Result := '';
  if Length(Text) > 16384 then Exit;
  At := Pos('"version"', Text); if At = 0 then Exit;
  Tail := Trim(Copy(Text, At + 9, Length(Text)));
  if (Length(Tail) = 0) or (Tail[1] <> ':') then Exit;
  Tail := Trim(Copy(Tail, 2, Length(Tail)));
  if (Length(Tail) < 3) or (Tail[1] <> '"') then Exit;
  Tail := Copy(Tail, 2, Length(Tail)); Finish := Pos('"', Tail);
  if Finish > 1 then Result := Copy(Tail, 1, Finish - 1);
end;

function ParseAppVersion(Value: String; var Major, Minor, Patch: Integer): Boolean;
var I, Dot, Number: Integer; Tail, Part: String;
begin
  Result := False; Tail := Value;
  for I := 1 to 3 do begin
    if I < 3 then begin
      Dot := Pos('.', Tail); if Dot < 2 then Exit;
      Part := Copy(Tail, 1, Dot - 1); Tail := Copy(Tail, Dot + 1, Length(Tail));
    end else Part := Tail;
    Number := StrToIntDef(Part, -1);
    if (Number < 0) or (Number > 65535) or (IntToStr(Number) <> Part) then Exit;
    if I = 1 then Major := Number else if I = 2 then Minor := Number else Patch := Number;
  end;
  Result := True;
end;

function CompareAppVersion(Left, Right: String): Integer;
var LA, LB, LC, RA, RB, RC: Integer;
begin
  // Malformed installed versions fail closed.
  Result := 1;
  if not ParseAppVersion(Left, LA, LB, LC) or not ParseAppVersion(Right, RA, RB, RC) then Exit;
  if (LA > RA) or ((LA = RA) and (LB > RB)) or ((LA = RA) and (LB = RB) and (LC > RC)) then Exit;
  if (LA < RA) or ((LA = RA) and (LB < RB)) or ((LA = RA) and (LB = RB) and (LC < RC)) then begin Result := -1; Exit; end;
  Result := 0;
end;
