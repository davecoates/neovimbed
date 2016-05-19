let neovimbed = {}
function neovimbed.NotifyIfNewEmptyBuffer(messageName)
    if expand("<afile>") == ""
        " No filename for current buffer
        call rpcnotify(0, a:messageName, [bufwinnr(""), bufnr(""), bufname(bufnr(""))], '')
    endif
endfunction
