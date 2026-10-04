"""History loader. Same output shape as the original (dicts with id,date,home,away,hs,as_,neutral,post,season), but backed by store/."""
STORE = None
def set_store(s):
    global STORE; STORE = s
def load(lg):
    return sorted(STORE.games[lg].values(), key=lambda g: g["date"])
