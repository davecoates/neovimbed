# Neovimbed

Embedded neovim in Atom.

Very alpha, use at your own risk!

# Installation

Make sure you have [neovim installed](https://github.com/neovim/neovim/wiki/Installing-Neovim).

All testing so far has been on OSX.

# What can you do?

This plugin passes all input through to a headless neovim instance and attempts to render the output - so
you can attempt to do whatever you like :) Plugins that just manipulate text should work as expected. Anything
involving new windows or splits won't work currently (or won't work how you might expect).

If text changes outside the visible screen (eg. from a search and replace) then Atom will likely display
outdated information as it currently just keeps the visible area up to date.
