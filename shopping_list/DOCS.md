# Shopping list is now Tidylist

The add-on has a new name, as the lists are for more than shopping. Home
Assistant sees Tidylist as a different add-on, so this one moves your lists
across.

1. Update this add-on to 0.13.0, and start it if it is not running. It
   copies your lists, files and photos to `/share` and stops. Its log says
   "Copied the lists".
2. Install **Tidylist** from the add-on store, and start it. On its first
   start it takes over the lists, with their labels, files and photos.
3. Check that your lists are in Tidylist, then uninstall this add-on.

If Tidylist was started before step 1, it already has an empty database of
its own, and does not take the lists over. Uninstall Tidylist, do step 1, and
install it again.
